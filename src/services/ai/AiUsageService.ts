import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from '@/services/SubscriptionService';
import { getRequiredCapabilityForTool } from './AiEntitlementService';
import { getToolUsageUnits, getDefaultMonthlyUnitsForPlan } from './aiUsageConfig';

/**
 * AiUsageService — the commercial "budget" layer for the AI Agent.
 *
 * Strictly separate from the other two systems this codebase already has,
 * on purpose:
 * - AiEntitlementService = "do I have the RIGHT to use this capability?"
 *   (a binary per-capability flag, never a quantity).
 * - ratelimit.ts (RateLimiterService) = "can I call this endpoint right
 *   NOW?" (a fixed technical window, identical for every plan, protecting
 *   infrastructure — never a commercial budget; its Upstash fallback is
 *   deliberately fail-OPEN, which AiUsageService must never copy).
 * - AiUsageService (this file) = "how much of this commercial budget have
 *   I already spent THIS BILLING PERIOD?" — the only one of the three
 *   with a quantity and a period.
 *
 * ONE global AI Units budget per (workspace, real billing period) — never
 * one quota per capability. Each tool's own unit cost (see
 * aiUsageConfig.ts) is what varies; the budget itself is a single number
 * per workspace per period.
 *
 * === Race-condition fix (reserve/finalize/release) ===
 *
 * The original V1 design was `hasQuotaRemaining()` (a non-atomic advisory
 * read) followed by the handler, followed by `recordUsage()` (the one
 * atomic write). A read-only audit found this left a real gap: two
 * concurrent requests could both pass `hasQuotaRemaining()` before either
 * had written anything, and both would then actually RUN their handler —
 * the counter itself could never overflow (recordUsage's own atomic
 * increment guaranteed that), but the HANDLER could still execute beyond
 * the workspace's real budget. For a `read`/`write` tool this was
 * harmless; for an `engage` tool (a real marketplace publish, a real
 * FulfillmentOrder) it was a genuine business risk.
 *
 * This is fixed by splitting consumption into three explicit steps, and —
 * critically — moving the ONE atomic operation to BEFORE the handler
 * instead of after it:
 *
 *   reserveUsage()   — atomically claims capacity. A handler may run
 *                      ONLY if this returns 'RESERVED'.
 *   finalizeUsage()  — call after the handler genuinely succeeds; moves
 *                      the held units from "reserved" to "consumed" (the
 *                      real, final, billed outcome).
 *   releaseUsage()   — call after the handler fails (or returns a
 *                      controlled business error); gives the held units
 *                      back without ever counting them as consumed
 *                      (V1's own "FAILED = 0" rule, preserved exactly).
 *
 * `AiUsagePeriod` now tracks TWO counters: `unitsConsumed` (final, billed)
 * and `unitsReserved` (currently held by an in-flight execution) — kept
 * as two separate columns rather than folding "reserved" into
 * "consumed", so the real, final billed total is never ambiguous with
 * in-flight holds (see prisma/schema.prisma's own comment on this choice).
 * The invariant enforced at all times is:
 *
 *   unitsConsumed + unitsReserved <= unitsLimit
 *
 * `reserveUsage`'s own atomic step needs to compare a NEW reservation
 * against the SUM of two columns (`unitsConsumed + unitsReserved`) in a
 * single condition — Prisma's query builder can express a bound on one
 * field at a time (exactly what `ProductService.reserveInventory` and
 * this file's own `finalizeUsage` use), but not an arithmetic relation
 * BETWEEN two columns. A plain JS-level "read both fields, then decide,
 * then write" is provably unsafe here: a concurrent `finalizeUsage` for a
 * DIFFERENT event can shift units from `unitsReserved` to `unitsConsumed`
 * (leaving their sum unchanged) between the read and the write, silently
 * invalidating a limit computed from a stale `unitsConsumed` snapshot.
 * So `reserveUsage` uses one minimal, fully parameterized raw SQL
 * `UPDATE ... WHERE unitsConsumed + unitsReserved + $units <= $limit`
 * (`$executeRaw`, never `$queryRaw`/string interpolation) — still a
 * single atomic PostgreSQL statement under the same row lock guarantee
 * every other conditional update in this codebase relies on, never
 * `$transaction`/`Serializable`. This is the same class of escape hatch
 * already used elsewhere in this codebase (`StockService.reserveStock`
 * calls a Postgres function via `$queryRaw` for the same reason) — this
 * file deliberately uses a plain inline `UPDATE`, not a stored function,
 * to keep the whole guarantee visible and self-contained in one migration.
 *
 * Idempotence (unchanged in spirit from V1): the (workspaceId,
 * idempotencyKey) UNIQUE constraint on AiUsageEvent is attempted FIRST,
 * before any counter is touched — only the request whose INSERT actually
 * wins ever proceeds to attempt a reservation. `finalizeUsage`/
 * `releaseUsage` are themselves gated by a conditional UPDATE on
 * `AiUsageEvent.status = 'RESERVED'` (the exact same pattern
 * `AiActionService.transition()` uses for AgentAction) — so at most ONE
 * of finalize/release can ever win for a given event, making both
 * naturally idempotent under retry or a duplicate call with no rollback
 * machinery needed.
 *
 * Honesty about what this does NOT guarantee: reserveUsage/finalizeUsage/
 * releaseUsage make the LOCAL quota bookkeeping exactly-once. They say
 * nothing about whether a real external marketplace call inside a
 * handler is itself exactly-once — that guarantee (or its absence) is
 * entirely up to the handler/adapter being called (e.g.
 * publish_listing's own real-call safeguard, or the
 * FulfillmentOrder.orderId unique constraint) and is never claimed here.
 *
 * Known V1 limitation, stated explicitly rather than hidden: a RESERVED
 * event whose caller crashes or is killed before ever calling
 * finalizeUsage/releaseUsage (e.g. a process restart mid-handler) stays
 * RESERVED forever — its units remain held, permanently reducing the
 * workspace's available budget until manual intervention. No reaper/TTL
 * job reclaims an orphaned reservation in this V1 (out of this task's
 * scope, and no such mechanism exists yet for the closest real
 * precedent either — AgentAction's own PENDING_CONFIRMATION TTL is
 * lazily expired only on next read, there is no background sweep there
 * either).
 */

export type AiUsageEventStatus = 'RESERVED' | 'RECORDED' | 'REJECTED' | 'RELEASED';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: 'no_quota_configured' | 'period_unavailable' | 'quota_exceeded';
}

export interface UsageOperationParams {
  toolName: string;
  idempotencyKey: string;
  conversationId?: string;
  actionId?: string;
  toolUseId?: string;
}

export interface ReserveUsageResult {
  status: AiUsageEventStatus;
  eventId: string | null;
  units: number;
  reason?: 'no_quota_configured' | 'period_unavailable' | 'quota_exceeded' | 'error';
}

export interface FinalizeReleaseResult {
  /** 'NOT_FOUND' covers both a no-cost tool (nothing was ever reserved) and a genuinely unknown key — both are safe no-ops for the caller. */
  status: AiUsageEventStatus | 'NOT_FOUND' | 'error';
}

export interface UsagePeriodSnapshot {
  periodStart: Date;
  periodEnd: Date;
  unitsConsumed: number;
  unitsReserved: number;
  unitsLimit: number;
}

interface ResolvedPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export class AiUsageService {
  /**
   * The real billing period for this workspace.
   *
   * A workspace with a REAL Stripe-backed Subscription (currentPeriodStart
   * AND currentPeriodEnd both set — see SubscriptionService/StripeService's
   * own comments: these are only ever written from a real Stripe
   * subscription.current_period_start/end) uses those exact boundaries —
   * NEVER a fabricated "YYYY-MM" key, since a real Stripe period can start
   * on any day of the month.
   *
   * A workspace with no real Subscription at all (pure Free, never
   * checked out) has no real billing period to anchor to — this falls
   * back, explicitly and only for this case, to a UTC calendar month:
   * [1st of the month 00:00 UTC, 1st of the next month 00:00 UTC). This
   * is a fixed calendar window, never a rolling 30-day window, so two
   * different real-world instants always resolve to the same period
   * boundaries (required for AiUsagePeriod's own uniqueness key to mean
   * anything stable).
   */
  private static async resolvePeriod(workspaceId: string): Promise<ResolvedPeriod | null> {
    try {
      const subscription = await SubscriptionService.getSubscription(workspaceId);
      if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
        return {
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
        };
      }
    } catch (error) {
      console.error('[AiUsageService] Error resolving subscription period:', error);
      return null;
    }

    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return { periodStart, periodEnd };
  }

  /**
   * The current monthly AI Units limit for this workspace — ALWAYS
   * resolved fresh (never trusted from a stale AiUsagePeriod.unitsLimit
   * snapshot alone), so a plan upgrade/downgrade mid-period is reflected
   * immediately without recreating the period row.
   *
   * Resolution order: WorkspaceAiOverride (if present) -> the workspace's
   * current effective plan's own default (aiUsageConfig.ts) — an
   * Enterprise workspace with no override row simply uses the Enterprise
   * plan's own default, exactly like every other plan.
   *
   * Fail-closed: an invalid override (missing/zero/negative
   * monthlyUnitsLimit) or an unrecognized plan name both return `null` —
   * never silently treated as "unlimited" or silently falling back to a
   * more permissive default.
   */
  private static async resolveMonthlyLimit(workspaceId: string): Promise<number | null> {
    try {
      const override = await prisma.workspaceAiOverride.findUnique({ where: { workspaceId } });
      if (override) {
        if (!Number.isInteger(override.monthlyUnitsLimit) || override.monthlyUnitsLimit <= 0) {
          console.error(`[AiUsageService] Invalid WorkspaceAiOverride for workspace ${workspaceId}: monthlyUnitsLimit=${override.monthlyUnitsLimit}`);
          return null;
        }
        return override.monthlyUnitsLimit;
      }

      const subscription = await SubscriptionService.getSubscription(workspaceId);
      const planName = subscription?.plan?.name;
      if (!planName) return null;
      return getDefaultMonthlyUnitsForPlan(planName);
    } catch (error) {
      console.error('[AiUsageService] Error resolving monthly AI Units limit:', error);
      return null;
    }
  }

  /**
   * Finds this (workspace, period)'s counter row, creating it on first use.
   * Concurrent first-use is handled the same way WebhookLog/AgentAction's
   * own dedup already is: attempt the create, and on a real
   * (workspaceId, periodStart, periodEnd) collision (P2002 — another
   * request won the same race a moment ago) simply re-read and return the
   * row that already exists. Exactly one row per period, ever.
   */
  private static async getOrCreatePeriodRow(
    workspaceId: string,
    period: ResolvedPeriod,
    unitsLimitSnapshot: number
  ): Promise<{ id: string; unitsConsumed: number; unitsReserved: number } | null> {
    try {
      const existing = await prisma.aiUsagePeriod.findUnique({
        where: { workspaceId_periodStart_periodEnd: { workspaceId, periodStart: period.periodStart, periodEnd: period.periodEnd } },
        select: { id: true, unitsConsumed: true, unitsReserved: true },
      });
      if (existing) return existing;

      try {
        const created = await prisma.aiUsagePeriod.create({
          data: {
            workspaceId,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            unitsConsumed: 0,
            unitsReserved: 0,
            unitsLimit: unitsLimitSnapshot,
          },
          select: { id: true, unitsConsumed: true, unitsReserved: true },
        });
        return created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const raceWinner = await prisma.aiUsagePeriod.findUnique({
            where: { workspaceId_periodStart_periodEnd: { workspaceId, periodStart: period.periodStart, periodEnd: period.periodEnd } },
            select: { id: true, unitsConsumed: true, unitsReserved: true },
          });
          if (raceWinner) return raceWinner;
        }
        throw error;
      }
    } catch (error) {
      console.error('[AiUsageService] Error resolving AiUsagePeriod row:', error);
      return null;
    }
  }

  /** Conditional transition out of RESERVED — the same idempotence guard AgentAction's own transition() uses. At most one caller ever wins this for a given event. */
  private static async claimTerminalStatus(eventId: string, to: 'RECORDED' | 'REJECTED' | 'RELEASED'): Promise<boolean> {
    const claim = await prisma.aiUsageEvent.updateMany({ where: { id: eventId, status: 'RESERVED' }, data: { status: to } });
    return claim.count > 0;
  }

  /**
   * Advisory, informational-only read — NOT an authorization gate (see
   * this file's own header comment on why the old check-then-execute
   * shape was unsafe). Safe to use for display (e.g. a future usage
   * dashboard) or as a cheap early hint before proposing an 'engage'
   * action, but a handler must never run on the strength of this call
   * alone — only a 'RESERVED' result from reserveUsage() authorizes that.
   */
  static async hasQuotaRemaining(workspaceId: string, toolName: string): Promise<QuotaCheckResult> {
    const units = getToolUsageUnits(toolName);
    if (units === null) return { allowed: true };

    const period = await this.resolvePeriod(workspaceId);
    if (!period) return { allowed: false, reason: 'period_unavailable' };

    const limit = await this.resolveMonthlyLimit(workspaceId);
    if (limit === null) return { allowed: false, reason: 'no_quota_configured' };

    const periodRow = await this.getOrCreatePeriodRow(workspaceId, period, limit);
    if (!periodRow) return { allowed: false, reason: 'period_unavailable' };

    return periodRow.unitsConsumed + periodRow.unitsReserved + units <= limit
      ? { allowed: true }
      : { allowed: false, reason: 'quota_exceeded' };
  }

  /**
   * The one authoritative, atomic authorization. A handler must only ever
   * run when this returns `status: 'RESERVED'` — every other status means
   * "do not execute the handler".
   *
   * A tool with no commercial cost (aiUsageConfig.getToolUsageUnits
   * returns null) always returns 'RESERVED' immediately, with no DB write
   * at all — the handler is always allowed to run for it, matching
   * hasQuotaRemaining's own short-circuit.
   *
   * Idempotent: the (workspaceId, idempotencyKey) UNIQUE constraint on
   * AiUsageEvent means a retry with the SAME key never creates a second
   * reservation — it returns the stored outcome of whichever attempt won
   * (RESERVED/RECORDED/REJECTED/RELEASED). A caller seeing anything other
   * than a freshly-won 'RESERVED' must not run the handler again under
   * that same key — see this file's own header comment on the limits of
   * what this guarantees for a real external call.
   */
  static async reserveUsage(workspaceId: string, params: UsageOperationParams): Promise<ReserveUsageResult> {
    const units = getToolUsageUnits(params.toolName);
    if (units === null) {
      return { status: 'RESERVED', eventId: null, units: 0 };
    }

    const period = await this.resolvePeriod(workspaceId);
    if (!period) {
      return { status: 'REJECTED', eventId: null, units, reason: 'period_unavailable' };
    }

    const capability = getRequiredCapabilityForTool(params.toolName) ?? 'unknown';

    let event: { id: string; status: string; units: number } | null = null;
    try {
      event = await prisma.aiUsageEvent.create({
        data: {
          workspaceId,
          conversationId: params.conversationId,
          actionId: params.actionId,
          toolUseId: params.toolUseId,
          toolName: params.toolName,
          capability,
          units,
          status: 'RESERVED',
          idempotencyKey: params.idempotencyKey,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        },
        select: { id: true, status: true, units: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lost the idempotency race — this exact operation was already
        // attempted (reserved/recorded/rejected/released) before. Never
        // attempt a second reservation for the same key; report the
        // stored outcome as-is so the caller never re-runs the handler.
        const existing = await prisma.aiUsageEvent.findUnique({
          where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: params.idempotencyKey } },
        });
        if (existing) {
          return { status: existing.status as AiUsageEventStatus, eventId: existing.id, units: existing.units };
        }
        return { status: 'REJECTED', eventId: null, units, reason: 'error' };
      }
      console.error('[AiUsageService] Error creating AiUsageEvent reservation:', error);
      return { status: 'REJECTED', eventId: null, units, reason: 'error' };
    }

    // Only the winner of the create() above ever reaches this point for a
    // given idempotencyKey — safe to attempt the reservation at most once.
    try {
      const limit = await this.resolveMonthlyLimit(workspaceId);
      if (limit === null) {
        await this.claimTerminalStatus(event.id, 'REJECTED');
        return { status: 'REJECTED', eventId: event.id, units, reason: 'no_quota_configured' };
      }

      const periodRow = await this.getOrCreatePeriodRow(workspaceId, period, limit);
      if (!periodRow) {
        await this.claimTerminalStatus(event.id, 'REJECTED');
        return { status: 'REJECTED', eventId: event.id, units, reason: 'period_unavailable' };
      }

      // The one atomic step: claims `units` of capacity IF AND ONLY IF
      // unitsConsumed + unitsReserved + units <= limit, in a single
      // PostgreSQL UPDATE — see this file's own header comment for why a
      // raw statement is used here (a two-column arithmetic condition
      // Prisma's query builder cannot express as one filter) and why this
      // is still safe (a single atomic statement, row-locked, never
      // $transaction/Serializable). Fully parameterized — no string
      // interpolation of any value.
      const claimed = await prisma.$executeRaw`
        UPDATE "AiUsagePeriod"
        SET "unitsReserved" = "unitsReserved" + ${units}, "updatedAt" = NOW()
        WHERE "id" = ${periodRow.id} AND "unitsConsumed" + "unitsReserved" + ${units} <= ${limit}
      `;

      if (claimed === 0) {
        await this.claimTerminalStatus(event.id, 'REJECTED');
        return { status: 'REJECTED', eventId: event.id, units, reason: 'quota_exceeded' };
      }

      return { status: 'RESERVED', eventId: event.id, units };
    } catch (error) {
      console.error('[AiUsageService] Error reserving usage:', error);
      await this.claimTerminalStatus(event.id, 'REJECTED').catch(() => undefined);
      return { status: 'REJECTED', eventId: event.id, units, reason: 'error' };
    }
  }

  /**
   * Call ONLY after the handler a reservation authorized has genuinely
   * succeeded. Moves the held units from "reserved" to "consumed" — the
   * real, final, billed outcome.
   *
   * Idempotent: gated by the same RESERVED->RECORDED conditional
   * transition as claimTerminalStatus — a retry (or a duplicate call)
   * after the first one already won never touches AiUsagePeriod a second
   * time, so unitsConsumed can never be double-incremented and
   * unitsReserved can never be double-decremented.
   *
   * A tool with no commercial cost (no AiUsageEvent was ever created) or
   * a genuinely unknown key both resolve to 'NOT_FOUND' — a safe no-op
   * for the caller, never an error.
   */
  static async finalizeUsage(workspaceId: string, idempotencyKey: string): Promise<FinalizeReleaseResult> {
    try {
      const event = await prisma.aiUsageEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } } });
      if (!event) return { status: 'NOT_FOUND' };
      if (event.status !== 'RESERVED') return { status: event.status as AiUsageEventStatus };

      const won = await this.claimTerminalStatus(event.id, 'RECORDED');
      if (!won) {
        // Lost a race to a concurrent finalize/release of the SAME event
        // (should not happen under correct single-caller usage, but never
        // trusted blindly) — report whatever actually won, never
        // re-attempt the counter move.
        const fresh = await prisma.aiUsageEvent.findUnique({ where: { id: event.id } });
        return { status: (fresh?.status as AiUsageEventStatus) ?? 'RECORDED' };
      }

      // Only the winner of the transition above ever reaches this —
      // moving the hold to consumed exactly once, unconditionally (the
      // conditional guard already happened on AiUsageEvent above).
      await prisma.aiUsagePeriod.updateMany({
        where: { workspaceId, periodStart: event.periodStart, periodEnd: event.periodEnd },
        data: { unitsReserved: { decrement: event.units }, unitsConsumed: { increment: event.units } },
      });

      return { status: 'RECORDED' };
    } catch (error) {
      console.error('[AiUsageService] Error finalizing usage:', error);
      return { status: 'error' };
    }
  }

  /**
   * Call after the handler a reservation authorized has failed (thrown,
   * or returned a controlled business error the caller treats as "did
   * not really succeed"). Gives the held units back — they are NEVER
   * counted as consumed, exactly preserving V1's "FAILED = 0" rule.
   *
   * Idempotent, same mechanism as finalizeUsage. Never decrements
   * unitsReserved twice for the same event.
   */
  static async releaseUsage(workspaceId: string, idempotencyKey: string): Promise<FinalizeReleaseResult> {
    try {
      const event = await prisma.aiUsageEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } } });
      if (!event) return { status: 'NOT_FOUND' };
      if (event.status !== 'RESERVED') return { status: event.status as AiUsageEventStatus };

      const won = await this.claimTerminalStatus(event.id, 'RELEASED');
      if (!won) {
        const fresh = await prisma.aiUsageEvent.findUnique({ where: { id: event.id } });
        return { status: (fresh?.status as AiUsageEventStatus) ?? 'RELEASED' };
      }

      await prisma.aiUsagePeriod.updateMany({
        where: { workspaceId, periodStart: event.periodStart, periodEnd: event.periodEnd },
        data: { unitsReserved: { decrement: event.units } },
      });

      return { status: 'RELEASED' };
    } catch (error) {
      console.error('[AiUsageService] Error releasing usage:', error);
      return { status: 'error' };
    }
  }

  /**
   * Read-only snapshot for display (e.g. a future usage dashboard) — `null`
   * when the period/limit can't be resolved at all. Callers must treat
   * `null` as "unavailable", never as "unlimited".
   */
  static async getUsageForCurrentPeriod(workspaceId: string): Promise<UsagePeriodSnapshot | null> {
    const period = await this.resolvePeriod(workspaceId);
    if (!period) return null;

    const limit = await this.resolveMonthlyLimit(workspaceId);
    if (limit === null) return null;

    const periodRow = await prisma.aiUsagePeriod.findUnique({
      where: { workspaceId_periodStart_periodEnd: { workspaceId, periodStart: period.periodStart, periodEnd: period.periodEnd } },
      select: { unitsConsumed: true, unitsReserved: true },
    });

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      unitsConsumed: periodRow?.unitsConsumed ?? 0,
      unitsReserved: periodRow?.unitsReserved ?? 0,
      unitsLimit: limit,
    };
  }
}

export default AiUsageService;
