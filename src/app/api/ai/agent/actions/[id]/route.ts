/**
 * GET /api/ai/agent/actions/:id
 * Phase 12A — reads the current state of one AgentAction (for the
 * frontend to poll/refresh a pending confirmation, or check the outcome
 * after confirming). Same auth/workspace/Business gate as
 * /api/ai/agent — this is the same paid capability, just reading one of
 * its action records back.
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session (session.user.workspaceId, re-verified via verifyWorkspaceAccess
 * against the database) — never accepted from the request as a source of
 * authorization. AiActionService.getAction filters by {id, workspaceId}
 * together, so an action belonging to another workspace is
 * indistinguishable from one that doesn't exist at all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { SubscriptionService } from '@/services/SubscriptionService';
import { AiActionService } from '@/services/ai/AiActionService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-agent-actions-route');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
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

    const action = await AiActionService.getAction(workspaceId, params.id);

    // Deliberately the same 404 whether the id doesn't exist at all or
    // belongs to another workspace — same non-enumeration pattern as
    // GET /api/ai/agent's conversation history lookup.
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, action });
  } catch (error) {
    logger.error('AI agent action lookup failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}
