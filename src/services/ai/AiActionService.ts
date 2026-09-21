import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { AiToolRegistry } from './AiToolRegistry';
import { AiEntitlementService, getRequiredCapabilityForTool } from './AiEntitlementService';
import { AiUsageService } from './AiUsageService';
import { getToolUsageUnits } from './aiUsageConfig';
import type { AgentToolCategory } from './tools/types';
import {
  type AgentActionStatus,
  canTransition,
  isExpired,
  ACTION_CONFIRMATION_TTL_MS,
} from '@/lib/ai/agentActionStateMachine';

const logger = createLogger('ai-action');

export interface AgentActionView {
  id: string;
  type: string;
  category: AgentToolCategory;
  status: AgentActionStatus;
  summary: Record<string, unknown>;
  confirmationRequired: boolean;
  expiresAt: string;
  result?: unknown;
  error?: string;
}

interface AgentActionRow {
  id: string;
  workspaceId: string;
  userId: string;
  conversationId: string;
  type: string;
  category: string;
  status: string;
  input: string;
  summary: string;
  confirmationRequired: boolean;
  expiresAt: Date;
  result: string | null;
  error: string | null;
}

function toView(row: AgentActionRow): AgentActionView {
  let summary: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.summary);
    summary = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    summary = {};
  }

  let result: unknown;
  if (row.result) {
    try {
      result = JSON.parse(row.result);
    } catch {
      result = undefined;
    }
  }

  return {
    id: row.id,
    type: row.type,
    category: row.category as AgentToolCategory,
    status: row.status as AgentActionStatus,
    summary,
    confirmationRequired: row.confirmationRequired,
    expiresAt: row.expiresAt.toISOString(),
    result,
    error: row.error ?? undefined,
  };
}

/**
 * Phase 12A — the backend authority for the whole
 * propose -> preview -> confirm -> execute -> audit pipeline behind any
 * 'engage' tool. AiAgentService is the only caller of proposeAction (the
 * model's tool_use is the only legitimate origin of a proposal — there is
 * deliberately no API route letting a client invent an action's type/input
 * directly; see the Phase 12A report). The three
 * confirm/cancel/get API routes under /api/ai/agent/actions/[id] are the
 * only callers of everything else here.
 *
 * Every method takes workspaceId as a plain parameter, already verified by
 * the caller (exactly like AiAgentService/AiToolRegistry tool handlers) —
 * never re-derived from anything model- or request-controlled — and every
 * Prisma query filters by {id, workspaceId} together, so an action
 * belonging to another workspace is indistinguishable from one that
 * doesn't exist at all (same pattern as
 * AiAgentService.getConversationHistory).
 */
export class AiActionService {
  private static async reload(actionId: string, workspaceId: string): Promise<AgentActionRow | null> {
    return prisma.agentAction.findFirst({ where: { id: actionId, workspaceId } });
  }

  /**
   * Attempts one state transition, gated by both the pure state-machine
   * rules (src/lib/ai/agentActionStateMachine.ts) AND an atomic
   * `updateMany({where: {..., status: from}})` — the real backend
   * idempotency/concurrency guard: if two requests race to confirm the
   * same action, only the one whose UPDATE actually matched a row still
   * in `from` wins; the other sees `count === 0` and must never proceed
   * to execute anything.
   */
  private static async transition(
    actionId: string,
    workspaceId: string,
    from: AgentActionStatus,
    to: AgentActionStatus,
    extraData: Record<string, unknown> = {}
  ): Promise<boolean> {
    if (!canTransition(from, to)) return false;
    const result = await prisma.agentAction.updateMany({
      where: { id: actionId, workspaceId, status: from },
      data: { status: to, ...extraData },
    });
    return result.count > 0;
  }

  /** PENDING_CONFIRMATION rows past their TTL are lazily moved to EXPIRED the next time they're read. */
  private static async maybeExpire(row: AgentActionRow): Promise<AgentActionRow> {
    if (row.status !== 'PENDING_CONFIRMATION' || !isExpired(row.expiresAt)) {
      return row;
    }
    const moved = await this.transition(row.id, row.workspaceId, 'PENDING_CONFIRMATION', 'EXPIRED');
    if (moved) {
      logger.info('ACTION_EXPIRED', { actionId: row.id, workspaceId: row.workspaceId });
    }
    const fresh = await this.reload(row.id, row.workspaceId);
    return fresh ?? row;
  }

  /**
   * Creates (or, for a repeated tool_use block, returns) the
   * PENDING_CONFIRMATION action for an 'engage' tool the model just asked
   * to call. `input` must already be the tool's own Zod-validated,
   * parsed data — never the model's raw, unvalidated tool_use.input.
   *
   * idempotencyKey is deterministic — `${conversationId}:${toolUseId}` —
   * so the same Anthropic tool_use block (e.g. from a retried turn) can
   * never create two rows for the same intent; the
   * (workspaceId, idempotencyKey) unique index makes that a real
   * DB-enforced guarantee, not just an application-level check.
   */
  static async proposeAction(params: {
    workspaceId: string;
    userId: string;
    conversationId: string;
    toolUseId: string;
    toolName: string;
    toolCategory: AgentToolCategory;
    preview: (() => Promise<Record<string, unknown>>) | undefined;
    input: unknown;
  }): Promise<AgentActionView> {
    const { workspaceId, userId, conversationId, toolUseId, toolName, toolCategory, preview, input } = params;
    const idempotencyKey = `${conversationId}:${toolUseId}`;

    const existing = await prisma.agentAction.findFirst({ where: { workspaceId, idempotencyKey } });
    if (existing) {
      return toView(existing);
    }

    const summary = preview ? await preview() : { type: toolName, input };
    const expiresAt = new Date(Date.now() + ACTION_CONFIRMATION_TTL_MS);

    const created = await prisma.agentAction.create({
      data: {
        workspaceId,
        userId,
        conversationId,
        type: toolName,
        category: toolCategory,
        status: 'PENDING_CONFIRMATION',
        input: JSON.stringify(input),
        summary: JSON.stringify(summary),
        confirmationRequired: true,
        idempotencyKey,
        expiresAt,
      },
    });

    logger.info('ACTION_CREATED', { actionId: created.id, workspaceId, conversationId, type: toolName });
    return toView(created);
  }

  /** Workspace-scoped read — null for "doesn't exist" and "belongs to another workspace" alike. */
  static async getAction(workspaceId: string, actionId: string): Promise<AgentActionView | null> {
    const row = await this.reload(actionId, workspaceId);
    if (!row) return null;
    return toView(await this.maybeExpire(row));
  }

  /**
   * Confirms and, if (and only if) the confirmation actually wins the
   * race, executes the action — the handler that actually publishes/buys/
   * mutates something external runs here, inside the backend, never in
   * response to the model deciding anything on its own.
   *
   * Idempotent by construction: an action already COMPLETED/FAILED simply
   * returns its stored outcome again (double-click, a browser retry, a
   * duplicate network request all land here safely, never re-running the
   * handler); CANCELLED/EXPIRED/EXECUTING are returned as-is for the
   * caller (the API route) to translate into the right HTTP status.
   */
  static async confirmAndExecute(workspaceId: string, userId: string, actionId: string): Promise<AgentActionView | null> {
    const row = await this.reload(actionId, workspaceId);
    if (!row) return null;

    const current = await this.maybeExpire(row);
    if (current.status !== 'PENDING_CONFIRMATION') {
      // COMPLETED/FAILED: idempotent replay of the stored outcome.
      // CANCELLED/EXPIRED/EXECUTING: nothing left (or safe) to do here.
      return toView(current);
    }

    const confirmed = await this.transition(actionId, workspaceId, 'PENDING_CONFIRMATION', 'CONFIRMED', {
      confirmedAt: new Date(),
    });
    if (!confirmed) {
      // Lost a race (another request confirmed/cancelled it, or it just
      // expired) — never proceed to execute; report whatever actually won.
      const fresh = await this.reload(actionId, workspaceId);
      return fresh ? toView(fresh) : null;
    }
    logger.info('ACTION_CONFIRMED', { actionId, workspaceId, userId });

    const executing = await this.transition(actionId, workspaceId, 'CONFIRMED', 'EXECUTING');
    if (!executing) {
      const fresh = await this.reload(actionId, workspaceId);
      return fresh ? toView(fresh) : null;
    }
    logger.info('ACTION_EXECUTION_STARTED', { actionId, workspaceId });

    const tool = AiToolRegistry.get(current.type);
    if (!tool) {
      // Shouldn't happen (the tool existed at proposal time) — never
      // trust that a previously-registered tool is still registered.
      const failed = await prisma.agentAction.update({
        where: { id: actionId },
        data: { status: 'FAILED', error: 'Action type is no longer available', executedAt: new Date() },
      });
      logger.error('ACTION_FAILED', new Error(`tool "${current.type}" no longer registered`), { actionId, workspaceId });
      return toView(failed);
    }

    // AiEntitlementService — re-checked here, not just at proposeAction
    // time (see AiAgentService.sendMessage's own check): the confirm
    // request can arrive up to ACTION_CONFIRMATION_TTL_MS later, long
    // enough for the workspace's plan/subscription to have genuinely
    // changed in between. A tool with no mapped capability (today: only
    // simulate_engage_action) is never refused here.
    const requiredCapability = getRequiredCapabilityForTool(current.type);
    if (requiredCapability && !(await AiEntitlementService.canUseCapability(workspaceId, requiredCapability))) {
      const failed = await prisma.agentAction.update({
        where: { id: actionId },
        data: { status: 'FAILED', error: `The "${requiredCapability}" capability is no longer available on this workspace's current plan.`, executedAt: new Date() },
      });
      logger.info('ACTION_FAILED_ENTITLEMENT_REFUSED', { actionId, workspaceId, capability: requiredCapability });
      return toView(failed);
    }

    // AiUsageService — checked before the handler runs, same reasoning as
    // the entitlement re-check above (a confirmation can arrive minutes
    // after proposeAction's own pre-check in AiAgentService). Nothing is
    // ever consumed here — recordUsage only ever runs below, after the
    // handler has already succeeded (see that call's own comment).
    const requiredUnits = getToolUsageUnits(current.type);
    if (requiredUnits !== null) {
      const quota = await AiUsageService.hasQuotaRemaining(workspaceId, current.type);
      if (!quota.allowed) {
        const failed = await prisma.agentAction.update({
          where: { id: actionId },
          data: { status: 'FAILED', error: 'This workspace has used its AI usage quota for the current billing period.', executedAt: new Date() },
        });
        logger.info('ACTION_FAILED_QUOTA_EXCEEDED', { actionId, workspaceId, toolName: current.type });
        return toView(failed);
      }
    }

    try {
      const parsedInput = JSON.parse(current.input);
      // Phase 12C-Offline fix: the action's OWN conversationId/userId
      // (captured at proposeAction time, itself already workspace-verified
      // — see resolveConversation) is threaded through here so a handler
      // that needs to revalidate something against this conversation's own
      // history (e.g. publish_listing re-confirming its sourceUrl/draft
      // still really belongs to this conversation before ever building a
      // real eBay payload) can do so at EXECUTE time, not just at preview
      // time. Previously this argument was never passed, silently leaving
      // `context` undefined for every handler called through confirmation.
      const result = await tool.handler(workspaceId, parsedInput, {
        conversationId: current.conversationId,
        userId: current.userId,
      });

      // AiUsageService — recorded only now, after the handler has
      // genuinely succeeded (no throw) AND returned a real result rather
      // than a controlled business refusal (the same `{error: string}`
      // shape convention checked elsewhere in this codebase — e.g.
      // send_to_fulfillment's own KNOWN_FULFILLMENT_ERRORS returns
      // `{error}` without throwing, and must not be billed either). V1
      // rule: FAILED/CANCELLED/EXPIRED never reach this line at all, so
      // they always consume 0 — see this method's own catch block and
      // cancelAction/maybeExpire, neither of which ever calls recordUsage.
      const resultSucceeded = !(
        result &&
        typeof result === 'object' &&
        typeof (result as Record<string, unknown>).error === 'string'
      );
      if (resultSucceeded) {
        await AiUsageService.recordUsage(workspaceId, {
          toolName: current.type,
          idempotencyKey: `action:${actionId}`,
          conversationId: current.conversationId,
          actionId,
        });
      }

      const completed = await prisma.agentAction.update({
        where: { id: actionId },
        data: { status: 'COMPLETED', result: JSON.stringify(result), executedAt: new Date() },
      });
      logger.info('ACTION_COMPLETED', { actionId, workspaceId });
      return toView(completed);
    } catch (error) {
      logger.error('ACTION_FAILED', error instanceof Error ? error : String(error), { actionId, workspaceId });
      const failed = await prisma.agentAction.update({
        where: { id: actionId },
        data: { status: 'FAILED', error: 'Action execution failed', executedAt: new Date() },
      });
      return toView(failed);
    }
  }

  /** Only a still-pending action can be cancelled — anything already confirmed/executing/terminal is returned as-is. */
  static async cancelAction(workspaceId: string, userId: string, actionId: string): Promise<AgentActionView | null> {
    const row = await this.reload(actionId, workspaceId);
    if (!row) return null;

    const current = await this.maybeExpire(row);
    if (current.status !== 'PENDING_CONFIRMATION') {
      return toView(current);
    }

    const cancelled = await this.transition(actionId, workspaceId, 'PENDING_CONFIRMATION', 'CANCELLED');
    if (!cancelled) {
      const fresh = await this.reload(actionId, workspaceId);
      return fresh ? toView(fresh) : null;
    }
    logger.info('ACTION_CANCELLED', { actionId, workspaceId, userId });
    const fresh = await this.reload(actionId, workspaceId);
    return fresh ? toView(fresh) : null;
  }
}

export default AiActionService;
