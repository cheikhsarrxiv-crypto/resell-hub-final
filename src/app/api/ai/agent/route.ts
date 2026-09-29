/**
 * POST /api/ai/agent
 * ADKSY AI Agent — V1 foundation: tool-use orchestration with exactly one
 * real tool (get_order). See src/services/ai/AiAgentService.ts and
 * src/services/ai/AiToolRegistry.ts.
 *
 * Distinct from /api/ai/chat (AiChatService), which remains untouched and
 * unaffected — that route stays a plain, ungated Q&A assistant. This
 * route is the new, tool-using Agent, available on every plan (Free
 * included) — differentiated by AI Units quota (AiUsageService), not by a
 * plan-level lockout. The aiAssistant feature check below is a plain
 * on/off kill switch, true for every real plan today.
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session (session.user.workspaceId, re-verified via verifyWorkspaceAccess
 * against the database) — never accepted from the request body/query as a
 * source of authorization, and never something the model can influence.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
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
 * aiAssistant gate as POST, deliberately: reading old Agent output goes
 * through the same check as generating new output. Not rate-limited by
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
        { error: 'The AI Agent is not enabled for this workspace. Contact support if you believe this is an error.' },
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

    // On/off kill switch, enforced server-side (not just hidden in the
    // UI) — reuses the existing Plan.aiAssistant flag and
    // SubscriptionService.hasFeature, exactly the mechanism already used
    // for fulfillmentEnabled/advancedAnalytics/apiAccess. True for every
    // real plan today (Free included) — the AI Agent is available on all
    // plans; usage is limited by AI Units quota (AiUsageService), never
    // by this flag alone. Left in place as a genuine kill switch, e.g. to
    // disable the Agent globally without touching every capability check.
    const hasAgentAccess = await SubscriptionService.hasFeature(workspaceId, 'aiAssistant');
    if (!hasAgentAccess) {
      return NextResponse.json(
        { error: 'The AI Agent is not enabled for this workspace. Contact support if you believe this is an error.' },
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
    //
    // Temporary diagnostic logging (AI agent 500 investigation): this
    // catch only ever sees an error thrown BEFORE AiAgentService.sendMessage's
    // own try block starts (e.g. a missing ANTHROPIC_API_KEY, thrown by
    // getClient() as a plain "AI agent is not configured" Error — never
    // an Anthropic.APIError instance, since no API call has happened
    // yet), or AiAgentService's own already-generic rethrown Error. The
    // isAnthropicError/status fields below are near-certainly false/null
    // here in practice — kept only so this catch's own log line is
    // self-describing if that assumption is ever wrong. No secret is
    // ever read from `error` here (see AiAgentService.ts's own catch for
    // the fields that actually matter for a real Anthropic failure).
    const isAnthropicError = error instanceof Anthropic.APIError;
    logger.error('AI agent request failed', error instanceof Error ? error : String(error), {
      status: isAnthropicError ? (error as InstanceType<typeof Anthropic.APIError>).status ?? null : undefined,
      cause: error instanceof Error && (error as { cause?: unknown }).cause ? String((error as { cause?: unknown }).cause) : undefined,
    });
    return errorResponse(error);
  }
}
