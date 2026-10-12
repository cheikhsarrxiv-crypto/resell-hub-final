/**
 * AI-first listing workflow — unit tests for
 * StorageService.rehostImageFromUrl: downloads a real
 * ImageGenerationProvider's own (temporary) image url and re-uploads its
 * bytes into ADKSY's own Supabase Storage bucket, WITHOUT creating its own
 * ProductImage row (create_product's own createMany batch does that).
 *
 * SSRF-hardening note: the actual download/redirect/DNS/streaming
 * mechanics now live in src/services/ssrfSafeFetch.ts and have their own
 * dedicated tests (ssrfSafeFetch.test.ts). This file mocks that module at
 * its boundary — its job is StorageService's OWN logic: real-byte MIME
 * verification (never trusting a declared Content-Type), file naming,
 * the Supabase upload call shape, and faithfully propagating (never
 * swallowing) whatever fetchSafely reports.
 *
 * Unlike storage-upload-real.test.ts (a real-credentials integration
 * test), this mocks @supabase/supabase-js and fetchSafely entirely, so it
 * always runs — proving the validate/upload logic itself, not real
 * network behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();
const fromMock = vi.fn(() => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }));
const fetchSafelyMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: fromMock } })),
}));

vi.mock('@/lib/prisma', () => ({
  default: {},
  prisma: {},
}));

vi.mock('@/services/ssrfSafeFetch', () => ({
  fetchSafely: (...args: unknown[]) => fetchSafelyMock(...args),
}));

// A real, valid 1x1 transparent PNG (67 bytes) — same fixture used by the
// real-credentials integration test, so this exercises real image bytes,
// not a fake/text buffer.
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const REAL_PNG_BUFFER = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');

describe('StorageService.rehostImageFromUrl', () => {
  let StorageService: typeof import('@/services/StorageService').StorageService;

  beforeEach(async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    uploadMock.mockReset();
    getPublicUrlMock.mockReset();
    fromMock.mockClear();
    fetchSafelyMock.mockReset();

    ({ StorageService } = await import('@/services/StorageService'));
  });

  it('downloads via fetchSafely, verifies real PNG bytes, and uploads to the product-images bucket — no DB row created', async () => {
    fetchSafelyMock.mockResolvedValue({
      buffer: REAL_PNG_BUFFER,
      contentType: 'image/png',
      finalUrl: 'https://oaidalleapi.example/temporary.png',
    });
    uploadMock.mockResolvedValue({ data: { path: 'ignored' }, error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: 'https://fake-project.supabase.co/storage/v1/object/public/product-images/ws-1/prod-1/generated-x.png' },
    });

    const result = await StorageService.rehostImageFromUrl({
      workspaceId: 'ws-1',
      productId: 'prod-1',
      sourceUrl: 'https://oaidalleapi.example/temporary.png',
    });

    expect(fetchSafelyMock).toHaveBeenCalledWith(
      'https://oaidalleapi.example/temporary.png',
      expect.objectContaining({ maxBytes: expect.any(Number), timeoutMs: expect.any(Number) })
    );
    expect(fromMock).toHaveBeenCalledWith('product-images');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [storagePathArg, , uploadOptions] = uploadMock.mock.calls[0];
    expect(storagePathArg).toMatch(/^ws-1\/prod-1\/generated-.*\.png$/);
    expect(uploadOptions).toMatchObject({ contentType: 'image/png', upsert: false });

    expect(result.url).toContain('product-images');
    expect(result.storagePath).toBe(storagePathArg);
  });

  it('propagates a fetchSafely SSRF rejection (e.g. non-https or private-address URL) without ever uploading', async () => {
    fetchSafelyMock.mockRejectedValue(new Error('Refusing to fetch a non-https URL (protocol was "http:")'));

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'http://x.example/img.png' })
    ).rejects.toThrow(/non-https/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a download failure (non-2xx) throws, never silently falls back to a fabricated url', async () => {
    fetchSafelyMock.mockRejectedValue(new Error('Failed to download image: 404 Not Found'));

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/gone.png' })
    ).rejects.toThrow(/failed to download/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a forged Content-Type (declared image/png, real bytes are not) is rejected — the declared header is never trusted', async () => {
    fetchSafelyMock.mockResolvedValue({
      buffer: Buffer.from('<html>not an image</html>'),
      contentType: 'image/png', // lies — real bytes below don't match any real signature
      finalUrl: 'https://x.example/not-an-image',
    });

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/not-an-image' })
    ).rejects.toThrow(/file type not allowed/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('bytes with an incorrect/corrupted signature are rejected even when no Content-Type was declared at all', async () => {
    fetchSafelyMock.mockResolvedValue({
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]), // matches none of the 4 allowed magic-byte signatures
      contentType: null,
      finalUrl: 'https://x.example/corrupted',
    });

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/corrupted' })
    ).rejects.toThrow(/file type not allowed: unknown/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('an oversized download (rejected by fetchSafely while streaming) propagates, never reaches upload', async () => {
    fetchSafelyMock.mockRejectedValue(new Error('File too large. Maximum size: 10485760 bytes'));

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/huge.png' })
    ).rejects.toThrow(/too large/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a timeout from fetchSafely propagates, never reaches upload', async () => {
    fetchSafelyMock.mockRejectedValue(new Error('Request timed out after 15000ms'));

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/slow.png' })
    ).rejects.toThrow(/timed out/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a raw network error from fetchSafely propagates, never reaches upload', async () => {
    fetchSafelyMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/img.png' })
    ).rejects.toThrow(/ECONNRESET/);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('a Supabase upload error surfaces clearly, never a fabricated success', async () => {
    fetchSafelyMock.mockResolvedValue({ buffer: REAL_PNG_BUFFER, contentType: 'image/png', finalUrl: 'https://x.example/img.png' });
    uploadMock.mockResolvedValue({ data: null, error: { message: 'bucket quota exceeded' } });

    await expect(
      StorageService.rehostImageFromUrl({ workspaceId: 'ws-1', productId: 'prod-1', sourceUrl: 'https://x.example/img.png' })
    ).rejects.toThrow(/bucket quota exceeded/);
  });
});
