/**
 * POST /api/ai/agent
 * ADKSY AI Agent — V1 foundation: tool-use orchestration with exactly one
 * real tool (get_order). See src/services/ai/AiAgentService.ts and
 * src/services/ai/AiToolRegistry.ts.
 *
 * Distinct from /api/ai/chat (AiChatService), which remains untouched and
 * unaffected — that route stays a plain, ungated Q&A assistant. This
 * route is the new, tool-using Agent, gated to the Business plan.
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session (session.user.workspaceId, re-verified via verifyWorkspaceAccess
 * against the database) — never accepted from the request body/query as a
 * source of authorization, and never something the model can influence.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { aiAgentMessageSchema } from '@/lib/validations';
import { rateLimiter } from '@/lib/ratelimit';
import { SubscriptionService } from '@/services/SubscriptionService';
import { AiAgentService } from '@/services/ai/AiAgentService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-agent-route');

// This route reads the authenticated session and calls an external AI
// provider per request — must never be statically rendered or cached.
export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/agent?conversationId=...
 * Phase 11D — restores a persisted conversation's UI-visible history
 * (see AiAgentService.getConversationHistory). Same auth/workspace/
 * Business gate as POST, deliberately: reading old Agent output is the
 * same paid capability as generating new output. Not rate-limited by
 * checkAiAgent — that budget protects real LLM/tool calls, not reading a
 * workspace's own already-computed history back.
 */
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

    const hasAgentAccess = await SubscriptionService.hasFeature(workspaceId, 'aiAssistant');
    if (!hasAgentAccess) {
      return NextResponse.json(
        { error: 'The AI Agent is available on the Business plan. Upgrade to unlock it.' },
        { status: 403 }
      );
    }

    const conversationId = request.nextUrl.searchParams.get('conversationId');
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const history = await AiAgentService.getConversationHistory(workspaceId, conversationId);

    // Deliberately the same 404 whether the id doesn't exist at all or
    // belongs to another workspace — see getConversationHistory's own
    // comment: never lets a client distinguish "not found" from "not
    // yours" for a resource it doesn't own.
    if (!history) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...history });
  } catch (error) {
    logger.error('AI agent history request failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // No fabricated "default" workspace: an account with no workspace on
    // its session has nothing for the agent to act on.
    if (!session.user.workspaceId) {
      return NextResponse.json(
        { error: 'No workspace found for this account' },
        { status: 403 }
      );
    }

    // Same ownership + verified-email check every other workspace-scoped
    // route in the app uses — re-verified fresh against the database, not
    // just trusted from the JWT. A workspace belonging to another user
    // throws here and is caught below as a 401/403.
    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId);

    // Business-tier gate, enforced server-side (not just hidden in the
    // UI) — reuses the existing Plan.aiAssistant flag and
    // SubscriptionService.hasFeature, exactly the mechanism already used
    // for fulfillmentEnabled/advancedAnalytics/apiAccess. This is a
    // deliberately different check from /api/ai/chat, which has no plan
    // gate at all today — the full Agent is a new, paid capability.
    const hasAgentAccess = await SubscriptionService.hasFeature(workspaceId, 'aiAssistant');
    if (!hasAgentAccess) {
      return NextResponse.json(
        { error: 'The AI Agent is available on the Business plan. Upgrade to unlock it.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const result = aiAgentMessageSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const rateLimit = await rateLimiter.checkAiAgent(workspaceId);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(
              (rateLimit.resetAt.getTime() - Date.now()) / 1000
            ).toString(),
          },
        }
      );
    }

    const { message, conversationId } = result.data;

    const turn = await AiAgentService.sendMessage(workspaceId, session.user.id, message, conversationId);

    return NextResponse.json({ success: true, ...turn });
  } catch (error) {
    // Never log the raw error at this layer either — AiAgentService
    // already logs provider/tool failures safely; other errors here
    // (auth, validation, conversation ownership) don't carry sensitive
    // data in their messages.
    logger.error('AI agent request failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}
