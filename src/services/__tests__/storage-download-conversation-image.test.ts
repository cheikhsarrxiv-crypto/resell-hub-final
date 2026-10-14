/**
 * Real photo analysis (free listing creation) — security tests for
 * StorageService.downloadConversationImageBytes, the function
 * AiAgentService.sendMessage now actually calls to fetch a conversation-
 * attached photo's real bytes before building a vision content block.
 * Mirrors storage-rehost-image.test.ts's own convention: mocks
 * @supabase/supabase-js and @/lib/prisma entirely, so this always runs
 * (never needs real credentials), and exercises the real
 * download/validate logic, not just a fake network response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const downloadMock = vi.fn();
const fromMock = vi.fn(() => ({ download: downloadMock }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: fromMock } })),
}));

const agentConversationFindFirstMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
  default: { agentConversation: { findFirst: agentConversationFindFirstMock } },
  prisma: { agentConversation: { findFirst: agentConversationFindFirstMock } },
}));

// A real, valid 1x1 transparent PNG (67 bytes) — same fixture already used
// by storage-rehost-image.test.ts, so the "real bytes, real signature"
// case genuinely has a real PNG signature to match against.
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');

function supabaseBlob(buffer: Buffer) {
  return { arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
}

describe('StorageService.downloadConversationImageBytes', () => {
  let StorageService: typeof import('@/services/StorageService').StorageService;

  beforeEach(async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    downloadMock.mockReset();
    fromMock.mockClear();
    agentConversationFindFirstMock.mockReset();
    agentConversationFindFirstMock.mockResolvedValue({ id: 'conv-1' });

    ({ StorageService } = await import('@/services/StorageService'));
  });

  it('a real photo under the correct workspace+conversation prefix, with a matching PNG signature, is returned', async () => {
    downloadMock.mockResolvedValue({ data: supabaseBlob(PNG_BYTES), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/123-abc.png',
    });

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
    expect(result!.buffer.equals(PNG_BYTES)).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('product-images');
  });

  it('a storagePath scoped to a DIFFERENT workspace is rejected before any storage call — never trusts the client-supplied path', async () => {
    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-ATTACKER/_draft-uploads/conv-1/123-abc.png',
    });

    expect(result).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('a storagePath scoped to a DIFFERENT conversation (same workspace) is rejected before any storage call', async () => {
    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-OTHER/123-abc.png',
    });

    expect(result).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('a storagePath with an unrecognized/disallowed extension is rejected before any storage call', async () => {
    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/payload.exe',
    });

    expect(result).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('the conversation not belonging to this workspace (re-verified against the DB, not just the path string) is rejected', async () => {
    agentConversationFindFirstMock.mockResolvedValue(null);

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/123-abc.png',
    });

    expect(result).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('a missing/inaccessible file in storage (download error) is rejected, never throws', async () => {
    downloadMock.mockResolvedValue({ data: null, error: { message: 'Object not found' } });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/missing.png',
    });

    expect(result).toBeNull();
  });

  it('an oversized file is rejected even though every other check passed', async () => {
    const oversized = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(11 * 1024 * 1024)]);
    downloadMock.mockResolvedValue({ data: supabaseBlob(oversized), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/huge.png',
    });

    expect(result).toBeNull();
  });

  it('a falsified attachment — real bytes that do NOT match the extension\'s claimed signature — is rejected (magic-byte check)', async () => {
    // Plain text content renamed to .png: extension says image/png, but the
    // actual bytes have no PNG signature at all.
    const notActuallyPng = Buffer.from('this is not an image, just renamed', 'utf-8');
    downloadMock.mockResolvedValue({ data: supabaseBlob(notActuallyPng), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/fake.png',
    });

    expect(result).toBeNull();
  });

  it('a JPEG renamed with a .png extension is rejected — signature must match the DERIVED mimeType, never the filename alone', async () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    downloadMock.mockResolvedValue({ data: supabaseBlob(jpegBytes), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/mislabeled.png',
    });

    expect(result).toBeNull();
  });

  it('P1-3 fix: a real PNG BETWEEN the vision-specific limit and the generic 10MB storage cap is rejected for vision — base64 encoding would exceed Anthropic\'s own 10MB-per-image limit', async () => {
    const { MAX_VISION_IMAGE_BYTES, MAX_FILE_SIZE } = await import('@/services/StorageService');
    expect(MAX_VISION_IMAGE_BYTES).toBeLessThan(MAX_FILE_SIZE);
    // A real PNG signature, padded to just over the vision-specific limit
    // but comfortably under the generic 10MB storage cap — this file would
    // still upload/store fine; only vision treats it as unavailable.
    const oversizedForVisionOnly = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(MAX_VISION_IMAGE_BYTES + 1024 * 100),
    ]);
    expect(oversizedForVisionOnly.length).toBeLessThan(MAX_FILE_SIZE);
    downloadMock.mockResolvedValue({ data: supabaseBlob(oversizedForVisionOnly), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/between-limits.png',
    });

    expect(result).toBeNull();
  });

  it('P1-3 fix: a real PNG just under the vision-specific limit is still accepted', async () => {
    const { MAX_VISION_IMAGE_BYTES } = await import('@/services/StorageService');
    const justUnderLimit = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(MAX_VISION_IMAGE_BYTES - 1024 * 100),
    ]);
    downloadMock.mockResolvedValue({ data: supabaseBlob(justUnderLimit), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/under-limit.png',
    });

    expect(result).not.toBeNull();
  });

  it('a real JPEG under a .jpg path is accepted, with mimeType derived from the extension', async () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    downloadMock.mockResolvedValue({ data: supabaseBlob(jpegBytes), error: null });

    const result = await StorageService.downloadConversationImageBytes({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      storagePath: 'ws-1/_draft-uploads/conv-1/real.jpg',
    });

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/jpeg');
  });
});
