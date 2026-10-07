/**
 * POST /api/ai/agent/photos
 *
 * AI-first "free listing creation" workflow — uploads a REAL photo the
 * reseller sends directly in an agent conversation, BEFORE any Product
 * exists for it to attach to (see StorageService.uploadConversationImage,
 * which this route is the only caller of). Returns a real, durable
 * {conversationId, url, storagePath, mimeType} — the frontend then
 * includes {url, storagePath, mimeType} in the `attachments` array of its
 * next POST /api/ai/agent call (using the returned conversationId for
 * that same call too, when it didn't already have one), where
 * AiAgentService.sendMessage records it against the conversation (see
 * that method's own comment on the synthetic 'user_photos_uploaded' tool
 * result — the only place an upload becomes something the Agent/later
 * tool calls can actually see and revalidate).
 *
 * Image-search feature (Phase 1) — first-message UX fix: `conversationId`
 * is now OPTIONAL. The composer may let the reseller attach a photo
 * before any conversation exists yet (no AgentConversation row — a brand
 * new Agent page load never has one until the first message is actually
 * sent). When conversationId is omitted, this route creates that row
 * itself, mirroring EXACTLY the same creation
 * AiAgentService.resolveConversation already performs for a brand-new
 * text-only turn (same {workspaceId, userId} shape) — never a different
 * or parallel conversation-creation path, just the same one triggered one
 * step earlier. The reseller's subsequent POST /api/ai/agent call for
 * this same turn then passes this exact id back, so
 * AiAgentService.resolveConversation finds the row this route already
 * created instead of creating a second one.
 *
 * This route itself never touches AgentMessage beyond creating/verifying
 * the owning AgentConversation (the latter done inside
 * StorageService.uploadConversationImage) — it has no notion of "this
 * turn" at all, only "this workspace may write to this conversation's
 * own upload path".
 *
 * SECURITY: workspaceId and userId come exclusively from the
 * authenticated session (same pattern as every other route under
 * /api/ai/agent) — never accepted from the request body as a source of
 * authorization, including when this route creates a new conversation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { prisma } from '@/lib/prisma';
import { StorageService } from '@/services/StorageService';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!session.user.workspaceId) {
      return NextResponse.json({ error: 'No workspace found for this account' }, { status: 403 });
    }
    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId);

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const conversationIdInput = formData.get('conversationId');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (conversationIdInput !== null && (typeof conversationIdInput !== 'string' || conversationIdInput.length === 0)) {
      return NextResponse.json({ error: 'conversationId, when provided, must be a non-empty string' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }
    const maxSize = 10 * 1024 * 1024; // 10MB — same bound as StorageService.MAX_FILE_SIZE
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    // Image-search feature (Phase 1) — see this file's own header comment.
    // Same {workspaceId, userId} shape as AiAgentService.resolveConversation's
    // own creation call, never a client-supplied owner.
    const conversationId =
      typeof conversationIdInput === 'string'
        ? conversationIdInput
        : (await prisma.agentConversation.create({ data: { workspaceId, userId: session.user.id }, select: { id: true } })).id;

    const buffer = Buffer.from(await file.arrayBuffer());

    const uploaded = await StorageService.uploadConversationImage({
      workspaceId,
      conversationId,
      file: buffer,
      fileName: file.name,
      mimeType: file.type,
    });

    return NextResponse.json({ success: true, conversationId, ...uploaded });
  } catch (error) {
    console.error('[AI agent photo upload] Error:', error);
    return errorResponse(error);
  }
}
