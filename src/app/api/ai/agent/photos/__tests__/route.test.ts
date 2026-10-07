/**
 * AI-first "free listing creation" workflow — source-level checks for
 * POST /api/ai/agent/photos, matching the established convention for every
 * other route under /api/ai/agent (see agent-route-security.test.ts and
 * usage/__tests__/route.test.ts's own header comments): this route imports
 * next/server + @/auth, which fails to resolve directly in this Vitest
 * setup, so auth/workspace-isolation/input-validation wiring is proven at
 * the source level here. The real upload behavior it delegates to
 * (StorageService.uploadConversationImage — MIME/size validation, the
 * workspace<->conversation ownership check, a real Supabase upload success/
 * failure) is already covered behaviorally in
 * storage-upload-conversation-image.test.ts; this file never re-asserts
 * that logic, only that the route itself is wired to call it correctly and
 * never trusts anything from the request body as a source of authorization.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(path.join(process.cwd(), 'src/app/api/ai/agent/photos/route.ts'), 'utf-8');

describe('/api/ai/agent/photos route — auth and workspace isolation', () => {
  it('checks session.user.id before doing anything else — unauthenticated is rejected', () => {
    const authIndex = routeSource.indexOf('await auth()');
    const unauthorizedIndex = routeSource.indexOf('status: 401');
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('never falls back to a fabricated default workspace when the session has none', () => {
    expect(routeSource).not.toContain("|| 'default'");
    expect(routeSource).toContain('if (!session.user.workspaceId)');
    expect(routeSource).toContain('status: 403');
  });

  it('calls verifyWorkspaceAccess — never trusts session.user.workspaceId directly as the source of authorization', () => {
    expect(routeSource).toContain("from '@/lib/security'");
    expect(routeSource).toContain('const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId)');
  });

  it('never reads workspaceId from the request body/formData — only from the verified session', () => {
    expect(routeSource).not.toContain("formData.get('workspaceId')");
  });

  it('passes the verified workspaceId (never a client-supplied one) to StorageService.uploadConversationImage', () => {
    const uploadCallIndex = routeSource.indexOf('StorageService.uploadConversationImage({');
    expect(uploadCallIndex).toBeGreaterThan(-1);
    const callBlock = routeSource.slice(uploadCallIndex, uploadCallIndex + 300);
    expect(callBlock).toContain('workspaceId,');
    expect(callBlock).toContain('conversationId,');
  });
});

describe('/api/ai/agent/photos route — input validation, before any upload is attempted', () => {
  it('rejects when no file is present in the form data', () => {
    const fileCheckIndex = routeSource.indexOf('if (!file)');
    expect(fileCheckIndex).toBeGreaterThan(-1);
    expect(routeSource.slice(fileCheckIndex, fileCheckIndex + 120)).toContain('status: 400');
  });

  it('Image-search feature (Phase 1) — conversationId is now OPTIONAL (first-message UX fix), but if provided it must be a non-empty string', () => {
    expect(routeSource).toContain(
      "conversationIdInput !== null && (typeof conversationIdInput !== 'string' || conversationIdInput.length === 0)"
    );
  });

  it('when conversationId is omitted, creates a new AgentConversation scoped to the verified workspaceId/session userId — never a client-supplied owner', () => {
    const createCallIndex = routeSource.indexOf('prisma.agentConversation.create(');
    expect(createCallIndex).toBeGreaterThan(-1);
    const callBlock = routeSource.slice(createCallIndex, createCallIndex + 200);
    expect(callBlock).toContain('workspaceId');
    expect(callBlock).toContain('session.user.id');
    // Mirrors AiAgentService.resolveConversation's own creation shape —
    // never a parallel/different conversation-creation mechanism.
    expect(routeSource).not.toContain("formData.get('userId')");
    expect(routeSource).not.toContain("formData.get('workspaceId')");
  });

  it('reuses the provided conversationId as-is when one is given — never creates a second conversation in that case', () => {
    const ternaryIndex = routeSource.indexOf('typeof conversationIdInput === \'string\'');
    expect(ternaryIndex).toBeGreaterThan(-1);
    expect(routeSource.slice(ternaryIndex, ternaryIndex + 80)).toContain('? conversationIdInput');
  });

  it('rejects a non-image MIME type before ever touching StorageService', () => {
    const mimeCheckIndex = routeSource.indexOf("file.type.startsWith('image/')");
    const uploadCallIndex = routeSource.indexOf('StorageService.uploadConversationImage({');
    expect(mimeCheckIndex).toBeGreaterThan(-1);
    expect(uploadCallIndex).toBeGreaterThan(-1);
    expect(mimeCheckIndex).toBeLessThan(uploadCallIndex);
  });

  it('rejects a file over the 10MB bound before ever touching StorageService — same bound as StorageService.MAX_FILE_SIZE', () => {
    const sizeCheckIndex = routeSource.indexOf('file.size > maxSize');
    const uploadCallIndex = routeSource.indexOf('StorageService.uploadConversationImage({');
    expect(sizeCheckIndex).toBeGreaterThan(-1);
    expect(uploadCallIndex).toBeGreaterThan(-1);
    expect(sizeCheckIndex).toBeLessThan(uploadCallIndex);
    expect(routeSource).toContain('10 * 1024 * 1024');
  });

  it('returns the real conversationId used plus {url, storagePath, mimeType} StorageService produced — never a fabricated value', () => {
    expect(routeSource).toContain('return NextResponse.json({ success: true, conversationId, ...uploaded });');
  });

  it('uses the shared errorResponse() helper on failure — same error-shape convention as every other /api/ai/agent route', () => {
    expect(routeSource).toContain("from '@/lib/security'");
    expect(routeSource).toContain('return errorResponse(error);');
  });
});
