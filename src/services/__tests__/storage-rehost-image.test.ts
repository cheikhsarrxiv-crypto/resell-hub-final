/**
 * AI-first listing workflow — unit tests for
 * StorageService.rehostImageFromUrl: downloads a real
 * ImageGenerationProvider's own (temporary) image url and re-uploads its
 * bytes into ADKSY's own Supabase Storage bucket, WITHOUT creating its own
 * ProductImage row (create_product's own createMany batch does that).
 *
 * Unlike storage-upload-real.test.ts (a real-credentials integration
 * test), this mocks @supabase/supabase-js and global fetch entirely, so it
 * always runs — proving the download/validate/upload logic itself, not
 * real network behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();
const fromMock = vi.fn(() => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: fromMock } })),
}));

vi.mock('@/lib/prisma', () => ({
  default: {},
  prisma: {},
}));

// A real, valid 1x1 transparent PNG (67 bytes) — same fixture used by the
// real-credentials integration test, so this exercises real image bytes,
// not a fake/text buffer.
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('StorageService.rehostImageFromUrl', () => {
  let originalFetch: typeof fetch;
  let StorageService: typeof import('@/services/StorageService').StorageService;

  beforeEach(async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    uploadMock.mockReset();
    getPublicUrlMock.mockReset();
    fromMock.mockClear();
    originalFetch = global.fetch;

    ({ StorageService } = await import('@/services/StorageService'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('downloads the source url and uploads its bytes to the product-images bucket, returning {url, storagePath} — no DB row created', async () => {
    const buffer = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    }) as any;
    uploadMock.mockResolvedValue({ data: { path: 'ignored' }, error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://fake-project.supabase.co/storage/v1/object/public/product-images/ws-1/prod-1/generated-x.png' } });

    const result = await StorageService.rehostImageFromUrl({
      workspaceId: 'ws-1',
      productId: 'prod-1',
      sourceUrl: 'https://oaidalleapi.example/temporary.png',
    });

    expect(fromMock).toHaveBeenCalledWith('product-images');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [storagePathArg, , uploadOptions] = uploadMock.mock.calls[0];
    expect(storagePathArg).toMatch(/^ws-1\/prod-1\/generated-.*\.png$/);
    expect(uploadOptions).toMatchObject({ contentType: 'image/png', upsert: false });

    expect(result.url).toContain('product-images');
    expect(result.storagePath).toBe(storagePathArg);
  });

  it('a non-2xx download response throws, never silently falls back to a fabricated url', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }) as any;

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/gone.png' })
    ).rejects.toThrow(/failed to download/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a disallowed content-type is rejected, never uploaded', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      arrayBuffer: async () => new ArrayBuffer(10),
    }) as any;

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/not-an-image' })
    ).rejects.toThrow(/file type not allowed/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('an oversized download is rejected before upload', async () => {
    const oversized = new ArrayBuffer(11 * 1024 * 1024); // > 10MB
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => oversized,
    }) as any;

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/huge.png' })
    ).rejects.toThrow(/too large/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a Supabase upload error surfaces clearly, never a fabricated success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new ArrayBuffer(10),
    }) as any;
    uploadMock.mockResolvedValue({ data: null, error: { message: 'bucket quota exceeded' } });

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/img.png' })
    ).rejects.toThrow(/bucket quota exceeded/);
  });
});
