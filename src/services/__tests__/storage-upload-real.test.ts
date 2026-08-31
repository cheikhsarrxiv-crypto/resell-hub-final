/**
 * Real, minimal integration test for StorageService.uploadImage() against
 * the actual Supabase Storage bucket "product-images". Only runs when
 * real Supabase Storage credentials are present in the environment
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — otherwise
 * skipped cleanly, same convention as the real eBay API tests in this repo
 * (src/__tests__/marketplace/ebay-oauth.test.ts).
 *
 * SAFETY:
 * - Postgres rows (User/Workspace/Product/ProductImage) are created in
 *   whatever database DATABASE_URL points to for the test run (the local
 *   disposable test database used by the rest of this suite) — never
 *   assumed to be the production Supabase Postgres database. Only the
 *   Storage upload/delete calls hit the real Supabase project, governed
 *   independently by NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
 * - The uploaded file and every DB row created here are deleted in a
 *   `finally` block, so nothing persists in the real bucket or the
 *   database regardless of whether the assertions pass or fail.
 * - Never logs or asserts on the literal value of any secret — only on
 *   the shape/content of StorageService's return value.
 */
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { StorageService } from '@/services/StorageService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const hasRealSupabaseCredentials = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

// A real, valid 1x1 transparent PNG (67 bytes) — not a fake/text buffer, so
// this genuinely exercises image upload behavior, not just a declared
// MIME-type label.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe.skipIf(!dbAvailable || !hasRealSupabaseCredentials)(
  'StorageService.uploadImage — real Supabase Storage (product-images bucket)',
  () => {
    it('uploads a single real 1x1 PNG, verifies the URL and storagePath, then deletes it', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const user = await prisma.user.create({
        data: {
          email: `storage-upload-test-${suffix}@example.com`,
          name: 'Storage Upload Test User',
          password: 'not-used',
        },
      });
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Storage Upload Test Workspace',
          slug: `storage-upload-test-${suffix}`,
          userId: user.id,
        },
      });
      const product = await prisma.product.create({
        data: {
          workspaceId: workspace.id,
          sku: `STORAGE-TEST-${suffix}`,
          title: 'Storage Upload Test Product',
          description: 'Created only to test image upload; deleted at the end of the test.',
        },
      });

      let uploadedImageId: string | null = null;

      try {
        const buffer = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');

        const productImage = await StorageService.uploadImage({
          workspaceId: workspace.id,
          productId: product.id,
          file: buffer,
          fileName: 'test-pixel.png',
          mimeType: 'image/png',
        });
        uploadedImageId = productImage.id;

        expect(productImage.url).toBeTruthy();
        expect(productImage.url).toContain('product-images');
        expect(productImage.storagePath).toContain(`${workspace.id}/${product.id}/`);
        expect(productImage.storagePath?.endsWith('.png')).toBe(true);
        expect(productImage.fileSize).toBe(buffer.length);

        // Confirms the file is actually reachable at the public URL — i.e.
        // the upload genuinely landed in Storage and the bucket is public
        // — not just that our own DB row looks right.
        const response = await fetch(productImage.url);
        expect(response.ok).toBe(true);
      } finally {
        // Always clean up, whether the assertions above passed or not —
        // removes both the real Storage object and the local DB row.
        if (uploadedImageId) {
          await StorageService.deleteImage(workspace.id, uploadedImageId).catch(() => {});
        }
        await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
        await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      }
    });
  }
);
