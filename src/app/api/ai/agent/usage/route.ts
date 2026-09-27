/**
 * GET /api/ai/agent/usage
 *
 * Read-only AI Units usage snapshot for the current workspace's billing
 * period — powers the usage indicator on /dashboard/agent (section 8 of
 * this task's brief: "afficher clairement la consommation ou la limite
 * disponible si le système possède déjà cette information"). Backed
 * entirely by the existing AiUsageService.getUsageForCurrentPeriod — no
 * new quota system, no new counter, just exposing data that already
 * exists.
 *
 * Deliberately NOT gated behind SubscriptionService.hasFeature(
 * workspaceId, 'aiAssistant') — the AI Agent (and therefore its usage
 * snapshot) is available on every plan today; this endpoint only reads a
 * workspace's own already-computed usage, never executes an AI action.
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session (session.user.workspaceId, re-verified via verifyWorkspaceAccess
 * against the database) — never accepted from the request as a source of
 * authorization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { AiUsageService } from '@/services/ai/AiUsageService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-agent-usage-route');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.user.workspaceId) {
      return NextResponse.json({ error: 'No workspace found for this account' }, { status: 403 });
    }

    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId);

    // null (period/limit unresolvable) is a valid, non-error outcome —
    // the frontend simply hides the usage indicator rather than treating
    // it as unlimited or as a failure. See getUsageForCurrentPeriod's own
    // comment.
    const snapshot = await AiUsageService.getUsageForCurrentPeriod(workspaceId);

    return NextResponse.json({
      success: true,
      usage: snapshot
        ? {
            unitsConsumed: snapshot.unitsConsumed,
            unitsReserved: snapshot.unitsReserved,
            unitsLimit: snapshot.unitsLimit,
            periodStart: snapshot.periodStart.toISOString(),
            periodEnd: snapshot.periodEnd.toISOString(),
          }
        : null,
    });
  } catch (error) {
    logger.error('AI agent usage lookup failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}
