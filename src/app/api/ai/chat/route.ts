/**
 * POST /api/ai/chat
 * ADKSY AI Assistant — V1: explain/guide only, no tools, no actions.
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session (session.user.workspaceId, re-verified via verifyWorkspaceAccess
 * against the database) — never accepted from the request body/query as a
 * source of authorization. The request schema below has no workspaceId
 * field at all, so a client-supplied one is never even parsed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { aiChatMessageSchema } from '@/lib/validations';
import { rateLimiter } from '@/lib/ratelimit';
import { AiChatService } from '@/services/AiChatService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-chat-route');

// This route reads the authenticated session and calls an external AI
// provider per request — must never be statically rendered or cached.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // No fabricated "default" workspace: an account with no workspace on
    // its session has nothing to give the assistant context about.
    if (!session.user.workspaceId) {
      return NextResponse.json(
        { error: 'No workspace found for this account' },
        { status: 403 }
      );
    }

    // Same ownership + verified-email check every other workspace-scoped
    // route in the app uses — re-verified fresh against the database.
    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId);

    const body = await request.json().catch(() => null);
    const result = aiChatMessageSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const rateLimit = await rateLimiter.checkAiChat(workspaceId);
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

    const { message, currentPage, history } = result.data;

    const reply = await AiChatService.sendMessage(workspaceId, message, currentPage, history);

    return NextResponse.json({ success: true, reply });
  } catch (error) {
    // Never log the raw error at this layer either — AiChatService
    // already logs provider failures safely; other errors here (auth,
    // validation) don't carry sensitive data in their messages.
    logger.error('AI chat request failed', error instanceof Error ? error : String(error));
    return errorResponse(error);
  }
}
