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

const BUCKET_NAME = 'products';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface UploadImageData {
  workspaceId: string;
  productId: string;
  file: File | Buffer;
  fileName: string;
  mimeType: string;
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
