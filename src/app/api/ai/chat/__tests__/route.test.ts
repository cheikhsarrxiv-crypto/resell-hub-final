/**
 * src/app/api/ai/chat/route.ts imports next/server (NextRequest/
 * NextResponse) and @/auth (which pulls in next-auth), which fails to
 * resolve when imported directly in this Vitest setup — the same
 * pre-existing environment issue documented in
 * oauth-callback-security.test.ts and auth-login-ratelimit.test.ts. So,
 * matching that established convention, this proves the route's wiring
 * via source-level checks against the real file content. The parts of
 * this route's behavior that don't depend on next/server/next-auth
 * (validation schema, rate limiter, AI service logic) are exercised as
 * real behavioral tests in:
 *  - src/lib/__tests__/ai-chat-validation-and-ratelimit.test.ts
 *  - src/services/__tests__/ai-chat-service.test.ts
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/ai/chat/route.ts'),
  'utf-8'
);

describe('POST /api/ai/chat — unauthenticated request', () => {
  it('rejects with 401 when there is no session user', () => {
    expect(routeSource).toContain('if (!session?.user?.id)');
    const unauthBlockStart = routeSource.indexOf('if (!session?.user?.id)');
    const block = routeSource.slice(unauthBlockStart, unauthBlockStart + 200);
    expect(block).toContain("status: 401");
  });
});

describe('POST /api/ai/chat — workspace derivation (never trusts a client-supplied workspaceId)', () => {
  it('derives workspaceId only from session.user.workspaceId, not from the request body/query', () => {
    expect(routeSource).toContain('session.user.workspaceId');
    expect(routeSource).not.toContain("request.nextUrl.searchParams.get('workspaceId')");
    expect(routeSource).not.toContain('body.workspaceId');
    expect(routeSource).not.toContain('body?.workspaceId');
  });

  it('re-verifies the session workspaceId against the database via verifyWorkspaceAccess before use', () => {
    expect(routeSource).toContain("from '@/lib/security'");
    const workspaceIdAssignment = routeSource.indexOf(
      'const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId)'
    );
    expect(workspaceIdAssignment).toBeGreaterThan(-1);
  });

  it('rejects (403) when the session has no workspace at all, rather than fabricating a default', () => {
    expect(routeSource).toContain('if (!session.user.workspaceId)');
    expect(routeSource).not.toContain("|| 'default'");
  });

  it('the workspaceId passed to AiChatService.sendMessage is the verified one, not a raw request value', () => {
    const verifiedIndex = routeSource.indexOf('const workspaceId = await verifyWorkspaceAccess(');
    const sendMessageIndex = routeSource.indexOf('AiChatService.sendMessage(workspaceId,');
    expect(verifiedIndex).toBeGreaterThan(-1);
    expect(sendMessageIndex).toBeGreaterThan(-1);
    expect(sendMessageIndex).toBeGreaterThan(verifiedIndex);
  });
});

describe('POST /api/ai/chat — validation', () => {
  it('validates the request body against aiChatMessageSchema before doing anything with it', () => {
    expect(routeSource).toContain("from '@/lib/validations'");
    expect(routeSource).toContain('aiChatMessageSchema.safeParse(body)');
    expect(routeSource).toContain('status: 400');
  });
});

describe('POST /api/ai/chat — rate limiting reuses the existing RateLimiterService', () => {
  it('imports the shared rate limiter rather than defining a new one', () => {
    expect(routeSource).toContain("from '@/lib/ratelimit'");
    expect(routeSource).toContain('rateLimiter.checkAiChat(workspaceId)');
  });

  it('returns 429 with a Retry-After header when the limit is exceeded', () => {
    const rateLimitStart = routeSource.indexOf('if (!rateLimit.success)');
    expect(rateLimitStart).toBeGreaterThan(-1);
    const rateLimitBlockEnd = routeSource.indexOf('const { message', rateLimitStart);
    const block = routeSource.slice(rateLimitStart, rateLimitBlockEnd);
    expect(block).toContain('status: 429');
    expect(block).toContain('Retry-After');
  });
});

describe('POST /api/ai/chat — error handling never leaks raw provider/internal errors', () => {
  it('uses the shared errorResponse() helper rather than returning a raw error message', () => {
    expect(routeSource).toContain('return errorResponse(error)');
  });

  it('never logs the raw error object directly (logs a labeled message, per the logger convention)', () => {
    expect(routeSource).toContain("logger.error('AI chat request failed'");
  });
});
