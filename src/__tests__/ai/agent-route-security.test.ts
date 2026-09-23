/**
 * Source-level checks for /api/ai/agent/route.ts.
 *
 * This route imports next/server (NextRequest/NextResponse) and @/auth
 * (which pulls in next-auth), which fails to resolve when imported
 * directly in this Vitest setup — the same pre-existing environment
 * issue documented in auth-login-ratelimit.test.ts and
 * oauth-callback-security.test.ts. So, matching that established
 * convention, this checks the route is wired correctly by inspecting its
 * source rather than executing it directly. The real behavior it wires
 * together (AiAgentService's tool-use loop, SubscriptionService.hasFeature,
 * RateLimiterService.checkAiAgent) is covered by direct behavioral tests
 * elsewhere (ai-agent-service.test.ts, subscription-*.test.ts,
 * ai-agent-validation-and-ratelimit.test.ts).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/ai/agent/route.ts'),
  'utf-8'
);

describe('/api/ai/agent route — auth, workspace isolation, and Business gating are wired in order', () => {
  it('checks session.user.id before doing anything else', () => {
    const authIndex = routeSource.indexOf('await auth()');
    const unauthorizedIndex = routeSource.indexOf("status: 401");
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('never falls back to a fabricated default workspace', () => {
    expect(routeSource).not.toContain("'default'");
    expect(routeSource).not.toContain('workspaceId: "default"');
  });

  it('calls verifyWorkspaceAccess (the same ownership + verified-email check every workspace-scoped route uses)', () => {
    expect(routeSource).toContain('verifyWorkspaceAccess(session.user.workspaceId)');
  });

  it('gates on SubscriptionService.hasFeature(workspaceId, "aiAssistant") — the Business-tier check — before calling the agent', () => {
    const gateIndex = routeSource.indexOf("hasFeature(workspaceId, 'aiAssistant')");
    const agentCallIndex = routeSource.indexOf('AiAgentService.sendMessage(');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(agentCallIndex).toBeGreaterThan(gateIndex);
  });

  it('responds 403 when the Business gate fails, without ever reaching the agent', () => {
    const gateIndex = routeSource.indexOf("hasFeature(workspaceId, 'aiAssistant')");
    const nextFewLines = routeSource.slice(gateIndex, gateIndex + 400);
    expect(nextFewLines).toContain('status: 403');
  });

  it('validates the request body with aiAgentMessageSchema before calling the agent', () => {
    const validateIndex = routeSource.indexOf('aiAgentMessageSchema.safeParse(body)');
    const agentCallIndex = routeSource.indexOf('AiAgentService.sendMessage(');
    expect(validateIndex).toBeGreaterThan(-1);
    expect(agentCallIndex).toBeGreaterThan(validateIndex);
  });

  it('rate-limits via checkAiAgent (a workspace-scoped limiter distinct from checkAiChat) before calling the agent', () => {
    const rateLimitIndex = routeSource.indexOf('rateLimiter.checkAiAgent(workspaceId)');
    const agentCallIndex = routeSource.indexOf('AiAgentService.sendMessage(');
    expect(rateLimitIndex).toBeGreaterThan(-1);
    expect(agentCallIndex).toBeGreaterThan(rateLimitIndex);
  });

  it('passes session.user.id (not a client-supplied value) as the agent conversation owner', () => {
    expect(routeSource).toContain('AiAgentService.sendMessage(workspaceId, session.user.id, message, conversationId)');
  });

  it('never logs the raw error object at this layer', () => {
    expect(routeSource).not.toMatch(/logger\.error\([^)]*,\s*error\s*\)/);
  });
});

describe('GET /api/ai/agent (Phase 11D) — auth, workspace isolation, and Business gating wired in the same order as POST', () => {
  const getFnSource = routeSource.slice(routeSource.indexOf('export async function GET'), routeSource.indexOf('export async function POST'));

  it('checks session.user.id first, before anything else', () => {
    const authIndex = getFnSource.indexOf('await auth()');
    const unauthorizedIndex = getFnSource.indexOf('status: 401');
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('calls verifyWorkspaceAccess exactly like POST — never trusts session.user.workspaceId directly', () => {
    expect(getFnSource).toContain('verifyWorkspaceAccess(session.user.workspaceId)');
  });

  it('gates on the Business plan before reading any conversation history', () => {
    const gateIndex = getFnSource.indexOf("hasFeature(workspaceId, 'aiAssistant')");
    const historyCallIndex = getFnSource.indexOf('getConversationHistory(');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(historyCallIndex).toBeGreaterThan(gateIndex);
  });

  it('requires conversationId as a query parameter, rejecting its absence with 400', () => {
    const paramIndex = getFnSource.indexOf("searchParams.get('conversationId')");
    expect(paramIndex).toBeGreaterThan(-1);
    expect(getFnSource).toContain('status: 400');
  });

  it('never reads workspaceId from the query string or request body — only from the verified session', () => {
    expect(getFnSource).not.toContain("searchParams.get('workspaceId')");
    expect(getFnSource).not.toContain('request.json()');
  });

  it('passes the server-verified workspaceId (never a client-supplied one) into getConversationHistory', () => {
    expect(getFnSource).toContain('getConversationHistory(workspaceId, conversationId)');
  });

  it('returns 404 (not 403) when the conversation is not found/not owned — never distinguishes the two to the client', () => {
    const historyCallIndex = getFnSource.indexOf('getConversationHistory(');
    const nextFewLines = getFnSource.slice(historyCallIndex, historyCallIndex + 600);
    expect(nextFewLines).toContain('status: 404');
  });

  it('never logs the raw error object at this layer either', () => {
    expect(getFnSource).not.toMatch(/logger\.error\([^)]*,\s*error\s*\)/);
  });
});
