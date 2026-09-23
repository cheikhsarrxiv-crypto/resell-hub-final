/**
 * POST /api/ai/agent/actions/:id/cancel
 * Phase 12A — the [Annuler] half of the confirmation UI. Only a still
 * PENDING_CONFIRMATION action can be cancelled; anything already
 * confirmed/executing/terminal is returned unchanged with a 409 — never
 * silently "succeeds" against a state it didn't actually change.
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

const logger = createLogger('ai-agent-actions-cancel-route');

export const dynamic = 'force-dynamic';

function statusCodeFor(action: AgentActionView): number {
  return action.status === 'CANCELLED' ? 200 : 409;
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

    const action = await AiActionService.cancelAction(workspaceId, session.user.id, params.id);

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json({ success: action.status === 'CANCELLED', action }, { status: statusCodeFor(action) });
  } catch (error) {
    logger.error('AI agent action cancellation failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}
