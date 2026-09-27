/**
 * Source-level checks for /api/ai/agent/usage/route.ts — same convention
 * as agent-route-security.test.ts (see its own header comment: this
 * route imports next/server + @/auth, which fails to resolve directly in
 * this Vitest setup).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/ai/agent/usage/route.ts'),
  'utf-8'
);

describe('/api/ai/agent/usage route — auth and workspace isolation', () => {
  it('checks session.user.id before doing anything else', () => {
    const authIndex = routeSource.indexOf('await auth()');
    const unauthorizedIndex = routeSource.indexOf('status: 401');
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('never falls back to a fabricated default workspace', () => {
    expect(routeSource).not.toContain("'default'");
  });

  it('calls verifyWorkspaceAccess — never trusts session.user.workspaceId directly', () => {
    expect(routeSource).toContain('verifyWorkspaceAccess(session.user.workspaceId)');
  });

  it('never reads workspaceId from the query string or request body — only from the verified session', () => {
    expect(routeSource).not.toContain("searchParams.get('workspaceId')");
    expect(routeSource).not.toContain('request.json()');
  });

  it('is deliberately NOT gated on the aiAssistant flag — the AI Agent (and its usage snapshot) is available on every plan', () => {
    expect(routeSource).not.toContain("hasFeature(workspaceId, 'aiAssistant')");
  });

  it('calls AiUsageService.getUsageForCurrentPeriod with the verified workspaceId', () => {
    expect(routeSource).toContain('AiUsageService.getUsageForCurrentPeriod(workspaceId)');
  });

  it('never logs the raw error object at this layer', () => {
    expect(routeSource).not.toMatch(/logger\.error\([^)]*,\s*error\s*\)/);
  });
});
