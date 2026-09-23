/**
 * Source-level checks for the Phase 12A action routes:
 * GET /api/ai/agent/actions/[id], POST .../confirm, POST .../cancel.
 *
 * Same convention as agent-route-security.test.ts (see its own header
 * comment): these routes import next/server + @/auth, which fails to
 * resolve directly in this Vitest setup, so wiring is checked at the
 * source level. The real state-machine/idempotency/cross-tenant behavior
 * they call into is covered behaviorally in ai-action-service.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

function readRoute(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

const getRoute = readRoute('src/app/api/ai/agent/actions/[id]/route.ts');
const confirmRoute = readRoute('src/app/api/ai/agent/actions/[id]/confirm/route.ts');
const cancelRoute = readRoute('src/app/api/ai/agent/actions/[id]/cancel/route.ts');

describe.each([
  ['GET /api/ai/agent/actions/[id]', getRoute],
  ['POST .../confirm', confirmRoute],
  ['POST .../cancel', cancelRoute],
])('%s — auth, workspace isolation, and Business gating', (_label, source) => {
  it('checks session.user.id before doing anything else', () => {
    const authIndex = source.indexOf('await auth()');
    const unauthorizedIndex = source.indexOf('status: 401');
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('never falls back to a fabricated default workspace', () => {
    expect(source).not.toContain("'default'");
  });

  it('derives workspaceId only from the verified session, never from the request', () => {
    expect(source).toContain('verifyWorkspaceAccess(session.user.workspaceId)');
    expect(source).not.toContain("searchParams.get('workspaceId')");
    expect(source).not.toContain('body.workspaceId');
  });

  it('gates on the Business plan (aiAssistant) before touching any action', () => {
    const gateIndex = source.indexOf("hasFeature(workspaceId, 'aiAssistant')");
    expect(gateIndex).toBeGreaterThan(-1);
    const nextFewLines = source.slice(gateIndex, gateIndex + 400);
    expect(nextFewLines).toContain('status: 403');
  });

  it('reads the action id only from the URL params, never from a client-supplied workspaceId/userId', () => {
    expect(source).toContain('params.id');
    expect(source).not.toContain('body.userId');
  });

  it('returns 404 when the action is not found (which AiActionService also returns for a cross-workspace id)', () => {
    expect(source).toContain('status: 404');
  });

  it('never logs the raw error object at this layer', () => {
    expect(source).not.toMatch(/logger\.error\([^)]*,\s*error\s*\)/);
  });
});

describe('GET /api/ai/agent/actions/[id]', () => {
  it('calls AiActionService.getAction with the verified workspaceId and the URL id', () => {
    expect(getRoute).toContain('AiActionService.getAction(workspaceId, params.id)');
  });
});

describe('POST /api/ai/agent/actions/[id]/confirm', () => {
  it('calls AiActionService.confirmAndExecute — the only path that can ever run an engage tool\'s handler', () => {
    expect(confirmRoute).toContain('AiActionService.confirmAndExecute(workspaceId, session.user.id, params.id)');
  });

  it('never accepts a bare {"confirmed": true} body as authorization — no request.json()/body parsing at all', () => {
    expect(confirmRoute).not.toContain('request.json()');
    expect(confirmRoute).not.toContain('.confirmed');
  });

  it('maps a non-terminal outcome (still pending/executing/cancelled/expired) to 409, not 200', () => {
    expect(confirmRoute).toContain('409');
  });
});

describe('POST /api/ai/agent/actions/[id]/cancel', () => {
  it('calls AiActionService.cancelAction with the verified workspaceId and the URL id', () => {
    expect(cancelRoute).toContain('AiActionService.cancelAction(workspaceId, session.user.id, params.id)');
  });

  it('maps "did not actually cancel" (already confirmed/executing/terminal) to 409, not 200', () => {
    expect(cancelRoute).toContain('409');
  });
});
