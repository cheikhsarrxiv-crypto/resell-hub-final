import { createClient } from '@supabase/supabase-js';
import prisma from '@/lib/prisma';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[StorageService] Supabase credentials not configured. Image uploads will fail.');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const BUCKET_NAME = 'product-images';
// Exported so other places that download/validate an image's bytes before
// handing them to a third party (e.g. EtsyAdapter.uploadListingImage's own
// caller in actionTools.ts) reuse the exact same rule — never a second,
// independently-drifting size/format list.
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Real photo analysis hardening (P1-3, final review finding) — the
 * Anthropic Messages API's own documented per-image limit, used directly
 * (first-party `new Anthropic({apiKey})` in AiAgentService — never
 * Bedrock/Vertex, whose limits differ) via `@anthropic-ai/sdk`, is 10MB
 * for a BASE64-ENCODED image (confirmed against
 * https://platform.claude.com/docs/en/build-with-claude/vision —
 * "Image limits and costs" — fetched and read directly in this session,
 * not assumed from training data). Base64 inflates raw bytes by exactly
 * 4/3 (3 raw bytes -> 4 encoded chars), so MAX_FILE_SIZE's own 10MB RAW
 * cap is NOT a safe proxy for that limit: a raw file between ~7.5MB and
 * 10MB encodes to between ~10MB and ~13.3MB and would be rejected by
 * Anthropic's own API after already passing every other check here,
 * aborting the whole turn (see AiAgentService.sendMessage's catch block)
 * instead of just this one photo. This constant is the largest raw byte
 * count whose base64 encoding is still guaranteed <= 10MB, and is applied
 * ONLY inside downloadConversationImageBytes (the vision-specific read
 * path) — MAX_FILE_SIZE itself is left untouched, so the generic upload
 * cap (uploadImage/uploadConversationImage/rehostImageFromUrl) and every
 * other feature that already accepts a file up to 10MB raw are
 * unaffected; a photo between this constant and MAX_FILE_SIZE can still
 * be uploaded and stored normally, only vision analysis of it degrades to
 * 'unavailable', exactly like any other download failure.
 */
export const MAX_VISION_IMAGE_BYTES = Math.floor((10 * 1024 * 1024 * 3) / 4); // 7.5MB raw -> <=10MB base64

export interface UploadImageData {
  workspaceId: string;
  productId: string;
  file: File | Buffer;
  fileName: string;
  mimeType: string;
}

export interface RehostImageData {
  workspaceId: string;
  productId: string;
  sourceUrl: string;
}

export interface RehostedImage {
  url: string;
  storagePath: string;
}

/**
 * Real-image-analysis hardening (free listing creation) — a minimal magic-
 * byte check so downloadConversationImageBytes never hands a renamed,
 * mismatched, or non-image file to the AI provider as if it were the
 * mimeType its own extension claims. Deliberately checks only the small,
 * well-documented leading signature each format always starts with
 * (never a full image-format parse, which this project has no library for
 * and should not add just for this) — a real image in one of the four
 * ALLOWED_MIME_TYPES always matches; anything else (a renamed .txt/.exe,
 * a truncated/corrupted upload) does not and is rejected before it can
 * ever reach a vision content block.
 */
function matchesImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  switch (mimeType) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    case 'image/gif':
      return buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a';
    case 'image/webp':
      return buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
    default:
      return false;
  }
}

export class StorageService {
  /**
   * Upload image to Supabase Storage
   * SECURITY: Validates workspace + product ownership
   */
  static async uploadImage(data: UploadImageData) {
    try {
      if (!supabase) {
        throw new Error('Storage service not configured. Please configure Supabase.');
      }

      // Validate file type
      if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
        throw new Error(`File type not allowed: ${data.mimeType}`);
      }

      // Validate file size
      let buffer: Buffer;
      if (data.file instanceof Buffer) {
        buffer = data.file;
      } else if (typeof (data.file as any).arrayBuffer === 'function') {
        buffer = Buffer.from(await (data.file as any).arrayBuffer());
      } else {
        buffer = Buffer.from(data.file as any);
      }
      
      if (buffer.length > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size: 10MB`);
      }

      // SECURITY: Verify workspace owns the product
      const product = await prisma.product.findUnique({
        where: { id: data.productId },
      });

      if (!product || product.workspaceId !== data.workspaceId) {
        throw new Error('Product not found or access denied');
      }

      // Generate storage path
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const ext = this.getFileExtension(data.mimeType);
      const storagePath = `${data.workspaceId}/${data.productId}/${timestamp}-${random}.${ext}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, buffer, {
          contentType: data.mimeType,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);

      const publicUrl = publicUrlData.publicUrl;

      // Save metadata to database
      const productImage = await prisma.productImage.create({
        data: {
          productId: data.productId,
          url: publicUrl,
          storagePath,
          mimeType: data.mimeType,
          fileSize: buffer.length,
        },
      });

      console.log(`[StorageService] Image uploaded: ${storagePath}`);
      return productImage;
    } catch (error) {
      console.error('[StorageService] Upload error:', error);
      throw error;
    }
  }

  /**
   * Downloads an image from an external URL (e.g. an AI image-generation
   * provider's own temporary URL — see generate_listing_draft_image /
   * OpenAIImageGenerationProvider's own documented ~1h expiry) and
   * re-uploads its bytes into ADKSY's own Supabase Storage bucket,
   * returning a durable {url, storagePath} pair.
   *
   * Deliberately does NOT create its own ProductImage row (unlike
   * uploadImage above) — callers that already batch-insert rows
   * themselves (create_product's own prisma.productImage.createMany)
   * attach the returned url/storagePath into their own row instead, so
   * there is only ever one write path for that table, never two racing
   * ones.
   *
   * Best-effort by design and never retried here: a failed download
   * (network error, non-2xx, disallowed content-type, oversized) simply
   * throws — the caller (create_product) already treats a single image's
   * failure as non-fatal to the product itself, exactly like it does for
   * the batch insert today.
   */
  static async rehostImageFromUrl(data: RehostImageData): Promise<RehostedImage> {
    if (!supabase) {
      throw new Error('Storage service not configured. Please configure Supabase.');
    }

    const response = await fetch(data.sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const normalizedContentType = contentType.split(';')[0].trim();
    if (!ALLOWED_MIME_TYPES.includes(normalizedContentType)) {
      throw new Error(`File type not allowed: ${normalizedContentType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('File too large. Maximum size: 10MB');
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const ext = this.getFileExtension(normalizedContentType);
    const storagePath = `${data.workspaceId}/${data.productId}/generated-${timestamp}-${random}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(storagePath, buffer, {
      contentType: normalizedContentType,
      upsert: false,
    });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);

    return { url: publicUrlData.publicUrl, storagePath };
  }

  /**
   * AI-first "free listing creation" workflow — uploads a REAL photo the
   * reseller sends directly in an agent conversation, BEFORE any Product
   * exists to attach it to (mirrors uploadImage's own MIME/size validation
   * exactly, minus the productId requirement — there is no Product yet).
   * Stored under a workspace+conversation scoped path, never under a
   * product's own path. Deliberately does NOT create a ProductImage row
   * (same reasoning as rehostImageFromUrl above) — the caller
   * (POST /api/ai/agent/photos) only ever hands the returned
   * {url, storagePath, mimeType} back to AiAgentService.sendMessage, which
   * records it as a synthetic, revalidatable tool result (see that
   * method's own comment); a real ProductImage row (sourceType:
   * 'USER_UPLOADED') is only ever created once create_product actually
   * runs, from that same already-durable url/storagePath — never a second
   * upload, never a second Supabase write for the same file.
   */
  static async uploadConversationImage(data: {
    workspaceId: string;
    conversationId: string;
    file: File | Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<{ url: string; storagePath: string; mimeType: string }> {
    if (!supabase) {
      throw new Error('Storage service not configured. Please configure Supabase.');
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      throw new Error(`File type not allowed: ${data.mimeType}`);
    }

    let buffer: Buffer;
    if (data.file instanceof Buffer) {
      buffer = data.file;
    } else if (typeof (data.file as any).arrayBuffer === 'function') {
      buffer = Buffer.from(await (data.file as any).arrayBuffer());
    } else {
      buffer = Buffer.from(data.file as any);
    }

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error('File too large. Maximum size: 10MB');
    }

    // SECURITY: verify the conversation itself belongs to this workspace
    // — AgentMessage/the conversation's own real tool-result history has
    // no other scoping of its own, so this is the actual isolation
    // boundary, never trusting a conversationId the caller merely passes
    // (same pattern as every verify*Access helper elsewhere).
    const conversation = await prisma.agentConversation.findFirst({
      where: { id: data.conversationId, workspaceId: data.workspaceId },
      select: { id: true },
    });
    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const ext = this.getFileExtension(data.mimeType);
    const storagePath = `${data.workspaceId}/_draft-uploads/${data.conversationId}/${timestamp}-${random}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(storagePath, buffer, {
      contentType: data.mimeType,
      upsert: false,
    });
    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);

    return { url: publicUrlData.publicUrl, storagePath, mimeType: data.mimeType };
  }

  /**
   * Image-search feature (Phase 1) — fetches a conversation-attached
   * photo's REAL bytes directly from Supabase Storage by its storagePath,
   * via the Supabase SDK's own authenticated `.download()` call — never a
   * raw fetch() of a client-supplied url. This is the actual SSRF guard:
   * aiAgentMessageSchema only validates that `attachments[].url` is *a*
   * well-formed URL, never that it points at this project's own Supabase
   * bucket, so a url string from the request body must never be
   * dereferenced server-side. storagePath, by contrast, is just a path
   * inside OUR OWN bucket — re-verified below to actually be scoped under
   * this exact workspace+conversation's own upload prefix (the same
   * prefix uploadConversationImage itself always writes to), so even a
   * forged storagePath can only ever resolve to this bucket, under this
   * workspace+conversation's own folder, never anywhere else.
   *
   * mimeType is deliberately re-derived from storagePath's own file
   * extension (the one uploadConversationImage itself wrote it with)
   * rather than trusted from the caller-supplied mimeType field — never
   * pass an unverified media_type for what becomes an Anthropic vision
   * content block.
   *
   * Returns null (never throws) on any failure — a missing, corrupted,
   * oversized, or wrong-type file must degrade this one photo to "could
   * not be used" for the caller, never crash the whole agent turn.
   */
  static async downloadConversationImageBytes(data: {
    workspaceId: string;
    conversationId: string;
    storagePath: string;
  }): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!supabase) return null;

    const expectedPrefix = `${data.workspaceId}/_draft-uploads/${data.conversationId}/`;
    if (!data.storagePath.startsWith(expectedPrefix)) {
      return null;
    }

    const extension = data.storagePath.split('.').pop()?.toLowerCase();
    const mimeType = (
      { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>
    )[extension ?? ''];
    if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return null;
    }

    const conversation = await prisma.agentConversation.findFirst({
      where: { id: data.conversationId, workspaceId: data.workspaceId },
      select: { id: true },
    });
    if (!conversation) return null;

    const { data: fileData, error } = await supabase.storage.from(BUCKET_NAME).download(data.storagePath);
    if (error || !fileData) return null;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    // MAX_FILE_SIZE (10MB raw) is the generic storage cap the upload step
    // already enforced — never loosened here. MAX_VISION_IMAGE_BYTES is
    // the STRICTER, vision-specific ceiling (see its own comment): a file
    // between the two still uploaded/stored fine, it just can't be safely
    // base64-encoded for Anthropic's own 10MB-base64 per-image limit, so
    // vision treats it as unavailable rather than letting Anthropic reject
    // the whole request later.
    if (buffer.length > MAX_FILE_SIZE || buffer.length > MAX_VISION_IMAGE_BYTES) return null;

    // Real-image-analysis hardening — the file's own leading bytes must
    // actually match what its extension/mimeType claims (see
    // matchesImageSignature's own comment). Never trusted on extension
    // alone before this is handed to a vision content block.
    if (!matchesImageSignature(buffer, mimeType)) return null;

    return { buffer, mimeType };
  }

  /**
   * Delete image from storage
   * SECURITY: Validates workspace + product ownership
   */
  static async deleteImage(workspaceId: string, imageId: string) {
    try {
      if (!supabase) {
        throw new Error('Storage service not configured');
      }

      // SECURITY: Get image and verify ownership
      const image = await prisma.productImage.findUnique({
        where: { id: imageId },
        include: { product: true },
      });

      if (!image || image.product.workspaceId !== workspaceId) {
        throw new Error('Image not found or access denied');
      }

      // Delete from storage if path exists
      if (image.storagePath) {
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([image.storagePath]);

        if (deleteError) {
          console.error('[StorageService] Storage deletion error:', deleteError);
          // Continue anyway - delete from DB
        }
      }

      // Delete from database
      await prisma.productImage.delete({
        where: { id: imageId },
      });

      console.log(`[StorageService] Image deleted: ${imageId}`);
    } catch (error) {
      console.error('[StorageService] Delete error:', error);
      throw error;
    }
  }

  /**
   * Update image metadata (alt text)
   * SECURITY: Validates workspace + product ownership
   */
  static async updateImage(workspaceId: string, imageId: string, altText?: string) {
    // SECURITY: Get image and verify ownership
    const image = await prisma.productImage.findUnique({
      where: { id: imageId },
      include: { product: true },
    });

    if (!image || image.product.workspaceId !== workspaceId) {
      throw new Error('Image not found or access denied');
    }

    return prisma.productImage.update({
      where: { id: imageId },
      data: {
        ...(altText !== undefined ? { altText } : {}),
      },
    });
  }

  /**
   * Update image order (for reordering)
   * SECURITY: Validates workspace + product ownership
   */
  static async updateImageOrder(
    workspaceId: string,
    productId: string,
    imageOrder: Array<{ id: string; order: number; isMain?: boolean }>
  ) {
    try {
      // SECURITY: Verify workspace owns the product
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product || product.workspaceId !== workspaceId) {
        throw new Error('Product not found or access denied');
      }

      // Update all images in transaction
      const updates = imageOrder.map((item) =>
        prisma.productImage.update({
          where: { id: item.id },
          data: {
            order: item.order,
            isMain: item.isMain || false,
          },
        })
      );

      await prisma.$transaction(updates);
      console.log(`[StorageService] Image order updated for product: ${productId}`);
    } catch (error) {
      console.error('[StorageService] Reorder error:', error);
      throw error;
    }
  }

  /**
   * Set main image for product
   * SECURITY: Validates workspace + product ownership
   */
  static async setMainImage(workspaceId: string, imageId: string) {
    try {
      // SECURITY: Get image and verify ownership
      const image = await prisma.productImage.findUnique({
        where: { id: imageId },
        include: { product: true },
      });

      if (!image || image.product.workspaceId !== workspaceId) {
        throw new Error('Image not found or access denied');
      }

      // Update in transaction: unset old main, set new main
      await prisma.$transaction([
        // Unset previous main image
        prisma.productImage.updateMany({
          where: { productId: image.productId, isMain: true },
          data: { isMain: false },
        }),
        // Set new main image
        prisma.productImage.update({
          where: { id: imageId },
          data: { isMain: true },
        }),
      ]);

      console.log(`[StorageService] Main image set: ${imageId}`);
    } catch (error) {
      console.error('[StorageService] Set main error:', error);
      throw error;
    }
  }

  /**
   * Get file extension from MIME type
   */
  private static getFileExtension(mimeType: string): string {
    const ext = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    }[mimeType] || 'jpg';
    return ext;
  }

  /**
   * Get product images with ownership verification
   * SECURITY: Validates workspace ownership
   */
  static async getProductImages(workspaceId: string, productId: string) {
    try {
      // Verify workspace owns product
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product || product.workspaceId !== workspaceId) {
        throw new Error('Product not found or access denied');
      }

      const images = await prisma.productImage.findMany({
        where: { productId },
        orderBy: { order: 'asc' },
      });

      return images;
    } catch (error) {
      console.error('[StorageService] Get images error:', error);
      throw error;
    }
  }
}
