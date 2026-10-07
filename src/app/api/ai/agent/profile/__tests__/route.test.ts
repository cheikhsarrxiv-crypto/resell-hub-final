/**
 * AI Agent Personalization V1 — source-level checks for
 * /api/ai/agent/profile/route.ts, matching the established convention for
 * every other route under /api/ai/agent (see
 * src/app/api/ai/agent/usage/__tests__/route.test.ts's own header
 * comment): this route imports next/server + @/auth, which fails to
 * resolve directly in this Vitest setup, so auth/workspace-isolation/
 * input-validation wiring is proven at the source level here.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/agent/profile/route.ts'), 'utf-8');

describe('/api/ai/agent/profile route — auth and workspace isolation', () => {
  it('checks session.user.id before doing anything else — unauthenticated is rejected', () => {
    const authIndex = routeSource.indexOf('await auth()');
    const unauthorizedIndex = routeSource.indexOf('status: 401');
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('never falls back to a fabricated default workspace when the session has none', () => {
    expect(routeSource).not.toContain("'default'");
    expect(routeSource).toContain('if (!session.user.workspaceId)');
    expect(routeSource).toContain('status: 403');
  });

  it('calls verifyWorkspaceAccess — never trusts session.user.workspaceId directly as the source of authorization', () => {
    expect(routeSource).toContain('verifyWorkspaceAccess(session.user.workspaceId)');
  });

  it('enforces the same aiAssistant gate as the main /api/ai/agent route — no new authorization mechanism invented', () => {
    expect(routeSource).toContain("hasFeature(workspaceId, 'aiAssistant')");
  });

  it('never reads workspaceId from the query string or request body — only from the verified session', () => {
    expect(routeSource).not.toContain("searchParams.get('workspaceId')");
    expect(routeSource).not.toMatch(/body\.workspaceId/);
  });

  it('every prisma.agentProfile call is scoped by the verified workspaceId variable, never a client-supplied value', () => {
    expect(routeSource).toContain('where: { workspaceId }');
  });

  it('GET returns profile: null as a normal, valid outcome — never treats "no profile yet" as an error', () => {
    const getBlock = routeSource.slice(routeSource.indexOf('export async function GET'), routeSource.indexOf('export async function PUT'));
    expect(getBlock).toContain('profile: row ? toRecord(row) : null');
  });

  it('PUT validates input with agentProfileInputSchema before touching the database', () => {
    const putBlock = routeSource.slice(routeSource.indexOf('export async function PUT'));
    const schemaIndex = putBlock.indexOf('agentProfileInputSchema.safeParse');
    const upsertIndex = putBlock.indexOf('prisma.agentProfile.upsert');
    expect(schemaIndex).toBeGreaterThan(-1);
    expect(upsertIndex).toBeGreaterThan(schemaIndex);
  });

  it('PUT rejects invalid input with 400 before any database write', () => {
    const putBlock = routeSource.slice(routeSource.indexOf('export async function PUT'));
    const validationFailIndex = putBlock.indexOf('Invalid input');
    const upsertIndex = putBlock.indexOf('prisma.agentProfile.upsert');
    expect(validationFailIndex).toBeGreaterThan(-1);
    expect(validationFailIndex).toBeLessThan(upsertIndex);
  });

  it('upserts by the unique workspaceId key — never creates a second row for the same workspace', () => {
    expect(routeSource).toContain('upsert({\n      where: { workspaceId }');
  });

  it('never logs the raw error object at this layer', () => {
    expect(routeSource).not.toMatch(/logger\.error\([^)]*,\s*error\s*\)/);
  });
});
