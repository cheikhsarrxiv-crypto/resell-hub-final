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
    if (buffer.length > MAX_FILE_SIZE) return null;

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
