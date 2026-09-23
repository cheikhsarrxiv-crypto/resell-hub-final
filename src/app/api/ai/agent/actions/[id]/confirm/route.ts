/**
 * POST /api/ai/agent/actions/:id/confirm
 * Phase 12A — the ONLY way an 'engage' tool's handler ever actually runs.
 * Never accepts a body ({"confirmed": true} alone means nothing here) —
 * the actionId in the URL, itself only resolvable within the caller's own
 * workspace, is what's confirmed. AiActionService.confirmAndExecute does
 * every remaining check: PENDING_CONFIRMATION, not expired, not already
 * consumed, and — via an atomic DB transition — safe under a double
 * click, a browser retry, or two concurrent requests.
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session, never from the request. Same auth/workspace/Business gate as
 * every other Agent route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { SubscriptionService } from '@/services/SubscriptionService';
import { AiActionService, type AgentActionView } from '@/services/ai/AiActionService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-agent-actions-confirm-route');

export const dynamic = 'force-dynamic';

/** COMPLETED/FAILED are the only statuses confirming can genuinely end at successfully (even if FAILED — the action DID run, just didn't succeed); everything else means nothing was confirmed/executed by this call. */
function statusCodeFor(action: AgentActionView): number {
  return action.status === 'COMPLETED' || action.status === 'FAILED' ? 200 : 409;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!session.user.workspaceId) {
      return NextResponse.json({ error: 'No workspace found for this account' }, { status: 403 });
    }

    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId);

    const hasAgentAccess = await SubscriptionService.hasFeature(workspaceId, 'aiAssistant');
    if (!hasAgentAccess) {
      return NextResponse.json(
        { error: 'The AI Agent is available on the Business plan. Upgrade to unlock it.' },
        { status: 403 }
      );
    }

    const action = await AiActionService.confirmAndExecute(workspaceId, session.user.id, params.id);

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json({ success: action.status === 'COMPLETED', action }, { status: statusCodeFor(action) });
  } catch (error) {
    logger.error('AI agent action confirmation failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}
