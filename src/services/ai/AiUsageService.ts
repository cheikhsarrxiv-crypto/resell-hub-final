import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from '@/services/SubscriptionService';
import { getRequiredCapabilityForTool } from './AiEntitlementService';
import { getToolUsageUnits, getDefaultMonthlyUnitsForPlan } from './aiUsageConfig';

/**
 * AiUsageService — the commercial "budget" layer for the AI Agent.
 *
 * Strictly separate from the other two systems this codebase already has,
 * on purpose (see the AiEntitlementService task's own architecture note):
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
 * one quota per capability — so this never turns into several
 * independent quota systems stacking accidentally. Each tool's own unit
 * cost (see aiUsageConfig.ts) is what varies; the budget itself is a
 * single number per workspace per period.
 *
 * Two tables back this (see prisma/schema.prisma's own "AI USAGE" section
 * for the full per-field rationale):
 * - AiUsageEvent: append-only audit trail, deduplicated by
 *   (workspaceId, idempotencyKey) — the real DB-enforced guard against
 *   double-counting a retry or a concurrent double-confirmation, mirroring
 *   AgentAction.idempotencyKey's own already-proven pattern exactly.
 * - AiUsagePeriod: the fast aggregate counter, incremented ONLY through
 *   the same atomic conditional `updateMany` pattern
 *   ProductService.reserveInventory already uses on Inventory.available —
 *   never a separate read-then-write, never `$transaction`/Serializable
 *   (not needed: a single conditional UPDATE is already atomic under
 *   PostgreSQL's own row lock for the matched row).
 *
 * Concurrency design, stated explicitly (not hidden): `hasQuotaRemaining`
 * is a plain, NON-atomic advisory read, called before a read/write tool's
 * handler runs so the overwhelming majority of over-quota attempts never
 * even reach it. The one authoritative, atomic decision is
 * `recordUsage()`, called only AFTER a handler has already succeeded. A
 * narrow race remains between the two (two concurrent requests could both
 * pass the advisory check) — deliberately left unclosed rather than built
 * out into a reserve-before-execute-then-roll-back-on-failure system,
 * which would itself be the "fragile rollback" this design was explicitly
 * told not to invent. The race is bounded and asymmetric-safe: it can
 * never double-charge or wrongly block a workspace — at worst, in a
 * genuinely rare concurrent race, one extra tool execution's real cost is
 * absorbed without being billed (recordUsage's own atomic increment still
 * correctly rejects it commercially). AiActionService's 'engage' pipeline
 * is naturally far less exposed to this window: it is already
 * confirmation-gated and its own state machine only ever lets a single
 * request reach EXECUTING per action.
 */

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: 'no_quota_configured' | 'period_unavailable' | 'quota_exceeded';
}

export interface RecordUsageParams {
  toolName: string;
  idempotencyKey: string;
  conversationId?: string;
  actionId?: string;
  toolUseId?: string;
}

export interface RecordUsageResult {
  status: 'RECORDED' | 'REJECTED';
  eventId: string | null;
  units: number;
  reason?: 'no_quota_configured' | 'period_unavailable' | 'quota_exceeded' | 'error';
}

export interface UsagePeriodSnapshot {
  periodStart: Date;
  periodEnd: Date;
  unitsConsumed: number;
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
  ): Promise<{ id: string; unitsConsumed: number } | null> {
    try {
      const existing = await prisma.aiUsagePeriod.findUnique({
        where: { workspaceId_periodStart_periodEnd: { workspaceId, periodStart: period.periodStart, periodEnd: period.periodEnd } },
        select: { id: true, unitsConsumed: true },
      });
      if (existing) return existing;

      try {
        const created = await prisma.aiUsagePeriod.create({
          data: {
            workspaceId,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            unitsConsumed: 0,
            unitsLimit: unitsLimitSnapshot,
          },
          select: { id: true, unitsConsumed: true },
        });
        return created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const raceWinner = await prisma.aiUsagePeriod.findUnique({
            where: { workspaceId_periodStart_periodEnd: { workspaceId, periodStart: period.periodStart, periodEnd: period.periodEnd } },
            select: { id: true, unitsConsumed: true },
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

  /**
   * Advisory, non-atomic pre-check — see this file's own header comment
   * on the concurrency tradeoff. A tool with no commercial cost
   * (aiUsageConfig.getToolUsageUnits returns null) is always allowed,
   * with no DB read at all.
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

    return periodRow.unitsConsumed + units <= limit
      ? { allowed: true }
      : { allowed: false, reason: 'quota_exceeded' };
  }

  /**
   * The one authoritative, atomic consumption. Must only ever be called
   * AFTER the real operation it bills for has already succeeded (a
   * handler that threw, or an AgentAction that ended FAILED/CANCELLED/
   * EXPIRED, must never reach this method at all — see
   * AiAgentService/AiActionService's own integration for where this is
   * enforced).
   *
   * Idempotence: the (workspaceId, idempotencyKey) UNIQUE constraint on
   * AiUsageEvent is attempted FIRST, before any counter is touched — only
   * the request whose INSERT actually wins ever proceeds to the atomic
   * increment below. This ordering (insert-then-increment, never
   * increment-then-insert) is what makes a double-confirmation or a
   * retry with the same key provably consume at most once: a loser of the
   * INSERT race never touches AiUsagePeriod at all, so there is nothing
   * to roll back.
   *
   * A tool with no commercial cost records nothing at all (no DB write),
   * mirroring hasQuotaRemaining's own short-circuit.
   */
  static async recordUsage(workspaceId: string, params: RecordUsageParams): Promise<RecordUsageResult> {
    const units = getToolUsageUnits(params.toolName);
    if (units === null) {
      return { status: 'RECORDED', eventId: null, units: 0 };
    }

    const period = await this.resolvePeriod(workspaceId);
    if (!period) {
      return { status: 'REJECTED', eventId: null, units, reason: 'period_unavailable' };
    }

    const capability = getRequiredCapabilityForTool(params.toolName) ?? 'unknown';

    let event: { id: string } | null = null;
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
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lost the idempotency race — this exact operation was already
        // recorded (or rejected) by a previous attempt. Never re-run the
        // increment below; just report the stored outcome.
        const existing = await prisma.aiUsageEvent.findUnique({
          where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: params.idempotencyKey } },
        });
        if (existing) {
          return {
            status: existing.status === 'REJECTED' ? 'REJECTED' : 'RECORDED',
            eventId: existing.id,
            units: existing.units,
          };
        }
        return { status: 'REJECTED', eventId: null, units, reason: 'error' };
      }
      console.error('[AiUsageService] Error creating AiUsageEvent:', error);
      return { status: 'REJECTED', eventId: null, units, reason: 'error' };
    }

    // Only the winner of the create() above ever reaches this point for a
    // given idempotencyKey — safe to increment at most once. Wrapped as a
    // whole so recordUsage NEVER throws past this point either — an
    // unexpected DB error here fails closed (REJECTED), it never
    // propagates to the caller (AiAgentService/AiActionService must never
    // crash mid-turn over a usage-recording failure).
    try {
      const limit = await this.resolveMonthlyLimit(workspaceId);
      if (limit === null) {
        await prisma.aiUsageEvent.update({ where: { id: event.id }, data: { status: 'REJECTED' } }).catch(() => undefined);
        return { status: 'REJECTED', eventId: event.id, units, reason: 'no_quota_configured' };
      }

      const periodRow = await this.getOrCreatePeriodRow(workspaceId, period, limit);
      if (!periodRow) {
        await prisma.aiUsageEvent.update({ where: { id: event.id }, data: { status: 'REJECTED' } }).catch(() => undefined);
        return { status: 'REJECTED', eventId: event.id, units, reason: 'period_unavailable' };
      }

      // Atomic conditional increment — same pattern as
      // ProductService.reserveInventory's `available: { gte: quantity }`.
      // `limit` here is the freshly-resolved current limit (see
      // resolveMonthlyLimit), never the possibly-stale periodRow snapshot.
      const claim = await prisma.aiUsagePeriod.updateMany({
        where: { id: periodRow.id, unitsConsumed: { lte: limit - units } },
        data: { unitsConsumed: { increment: units } },
      });

      const finalStatus: 'RECORDED' | 'REJECTED' = claim.count > 0 ? 'RECORDED' : 'REJECTED';
      await prisma.aiUsageEvent.update({ where: { id: event.id }, data: { status: finalStatus } }).catch((updateError) => {
        // The counter's own state (incremented or not) is already correct
        // and durable regardless of this bookkeeping update's outcome —
        // never retried, never allowed to change the real decision above.
        console.error('[AiUsageService] Failed to finalize AiUsageEvent status:', updateError);
      });

      return {
        status: finalStatus,
        eventId: event.id,
        units,
        reason: finalStatus === 'REJECTED' ? 'quota_exceeded' : undefined,
      };
    } catch (error) {
      console.error('[AiUsageService] Error recording usage:', error);
      await prisma.aiUsageEvent.update({ where: { id: event.id }, data: { status: 'REJECTED' } }).catch(() => undefined);
      return { status: 'REJECTED', eventId: event.id, units, reason: 'error' };
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
      select: { unitsConsumed: true },
    });

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      unitsConsumed: periodRow?.unitsConsumed ?? 0,
      unitsLimit: limit,
    };
  }
}

export default AiUsageService;
