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

/**
 * Diagnostic fix (profile 403 vs agent-search 500 investigation) — a
 * stable `code` field on every non-2xx body, so the frontend
 * (interpretProfileResponse, agentConversation.ts) never has to guess the
 * cause from the human-readable `error` string. Every status below is
 * asserted to be UNCHANGED from before this fix — only `code` is new.
 */
describe('/api/ai/agent/profile route — stable error codes (statuses unchanged)', () => {
  it('no workspaceId on the session -> 403 with code NO_WORKSPACE', () => {
    const idx = routeSource.indexOf('if (!session.user.workspaceId)');
    const block = routeSource.slice(idx, idx + 200);
    expect(block).toContain("status: 403");
    expect(block).toContain("code: 'NO_WORKSPACE'");
  });

  it('aiAssistant feature disabled -> 403 with code FEATURE_DISABLED', () => {
    const idx = routeSource.indexOf('if (!hasAgentAccess)');
    const block = routeSource.slice(idx, routeSource.indexOf('return workspaceId'));
    expect(block).toContain("status: 403");
    expect(block).toContain("code: 'FEATURE_DISABLED'");
  });

  it('no session at all -> 401 with code UNAUTHORIZED', () => {
    const idx = routeSource.indexOf('if (!session?.user?.id)');
    const block = routeSource.slice(idx, idx + 200);
    expect(block).toContain('status: 401');
    expect(block).toContain("code: 'UNAUTHORIZED'");
  });

  it('profileErrorResponse exists as its own local mapper, never routed through the shared errorResponse() (which has no `code` field and is used by many other routes)', () => {
    expect(routeSource).toContain('function profileErrorResponse(error: unknown)');
    expect(routeSource).not.toContain('errorResponse(error)');
    expect(routeSource).not.toMatch(/import\s*\{[^}]*\berrorResponse\b[^}]*\}\s*from\s*'@\/lib\/security'/);
  });

  it('profileErrorResponse mirrors the shared errorResponse() precedence exactly (same branches, same order) — only `code` is added, no status ever changes', () => {
    const fnStart = routeSource.indexOf('function profileErrorResponse');
    const fnBody = routeSource.slice(fnStart, routeSource.indexOf('\n}', fnStart));

    const unauthorizedIdx = fnBody.indexOf("message.includes('unauthorized')");
    const emailIdx = fnBody.indexOf("message === 'Email verification required'");
    const notFoundIdx = fnBody.indexOf("message.includes('not found')");
    const requiredIdx = fnBody.indexOf("message.includes('required')");

    expect(unauthorizedIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeGreaterThan(unauthorizedIdx);
    expect(notFoundIdx).toBeGreaterThan(emailIdx);
    expect(requiredIdx).toBeGreaterThan(notFoundIdx);

    expect(fnBody).toContain("code: 'EMAIL_UNVERIFIED'");
    expect(fnBody).toContain("status: 403");
    expect(fnBody).toContain("code: 'NOT_FOUND'");
    expect(fnBody).toContain("status: 404");
    expect(fnBody).toContain("code: 'SERVER_ERROR'");
    expect(fnBody).toContain("status: 500");
  });

  it('both GET and PUT route their catch block through profileErrorResponse', () => {
    const occurrences = [...routeSource.matchAll(/return profileErrorResponse\(error\)/g)];
    expect(occurrences.length).toBe(2);
  });
});
