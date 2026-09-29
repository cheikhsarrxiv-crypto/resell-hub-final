/**
 * Source-level checks for /api/notifications/route.ts — same convention
 * as usage/__tests__/route.test.ts (this route imports next/server, which
 * fails to resolve directly in this Vitest setup).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(path.join(process.cwd(), 'src/app/api/notifications/route.ts'), 'utf-8');

describe('/api/notifications route — auth and workspace/user isolation', () => {
  it('GET calls requireAuth (the real session user id) before reading anything', () => {
    const authIndex = routeSource.indexOf('const userId = await requireAuth()');
    const findManyIndex = routeSource.indexOf('prisma.notification.findMany');
    expect(authIndex).toBeGreaterThan(-1);
    expect(findManyIndex).toBeGreaterThan(authIndex);
  });

  it('GET scopes the query to the authenticated userId, never a client-supplied one', () => {
    expect(routeSource).toContain('where: { userId }');
  });

  it('PATCH also requires auth and scopes the update to the authenticated userId', () => {
    const patchAuthIndex = routeSource.lastIndexOf('const userId = await requireAuth()');
    expect(patchAuthIndex).toBeGreaterThan(-1);
    expect(routeSource).toContain('{ id, userId }');
    expect(routeSource).toContain('{ userId }');
  });

  it('never reads userId/workspaceId from the request body or query string directly', () => {
    expect(routeSource).not.toContain("searchParams.get('userId')");
    expect(routeSource).not.toContain('body.userId');
    expect(routeSource).not.toContain('body?.userId');
  });

  it('is marked dynamic (never statically cached for a per-user response)', () => {
    expect(routeSource).toContain("export const dynamic = 'force-dynamic'");
  });

  it('errors are routed through the shared errorResponse helper, never a raw error leak', () => {
    expect(routeSource).toContain('errorResponse(error)');
  });
});
