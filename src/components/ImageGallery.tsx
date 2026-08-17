'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { GripVertical, Trash2, Star } from 'lucide-react';
import { Button } from './UI/Button';

interface ProductImageItem {
  id: string;
  url: string;
  altText?: string;
  order: number;
  isMain: boolean;
}

interface ImageGalleryProps {
  images: ProductImageItem[];
  onReorder?: (images: Array<{ id: string; order: number; isMain: boolean }>) => Promise<void>;
  onDelete?: (imageId: string) => Promise<void>;
  onSetMain?: (imageId: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export function ImageGallery({
  images: initialImages,
  onReorder,
  onDelete,
  onSetMain,
  isLoading = false,
  error = null,
}: ImageGalleryProps) {
  const [images, setImages] = useState<ProductImageItem[]>(initialImages);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingMainId, setSettingMainId] = useState<string | null>(null);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...images];
    const draggedImage = newImages[draggedIndex];
    newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedImage);
    setDraggedIndex(index);

    // Update order
    newImages.forEach((img, i) => {
      img.order = i;
    });

    setImages(newImages);
  };

  const handleDragEnd = async () => {
    if (!onReorder) {
      setDraggedIndex(null);
      return;
    }

    try {
      await onReorder(
        images.map((img) => ({
          id: img.id,
          order: img.order,
          isMain: img.isMain,
        }))
      );
    } catch (err) {
      console.error('Reorder failed:', err);
      // Revert to initial order
      setImages(initialImages);
    } finally {
      setDraggedIndex(null);
    }
  };

  const handleDelete = async (imageId: string) => {
    if (!onDelete) return;

    setDeletingId(imageId);
    try {
      await onDelete(imageId);
      setImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetMain = async (imageId: string) => {
    if (!onSetMain) return;

    setSettingMainId(imageId);
    try {
      await onSetMain(imageId);
      setImages((prev) =>
        prev.map((img) => ({
          ...img,
          isMain: img.id === imageId,
        }))
      );
    } catch (err) {
      console.error('Set main failed:', err);
    } finally {
      setSettingMainId(null);
    }
  };

  if (images.length === 0) {
    return (
      <div className="text-center py-12 text-gray-600">
        <p>No images yet. Upload some photos to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <p className="text-sm text-gray-600">
        Drag to reorder • Click star to set main image
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {images.map((image, index) => (
          <div
            key={image.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`relative group bg-gray-100 rounded-lg overflow-hidden cursor-move transition-opacity ${
              draggedIndex === index ? 'opacity-50' : 'opacity-100'
            }`}
          >
            {/* Image */}
            <div className="aspect-square relative">
              <Image
                src={image.url}
                alt={image.altText || 'Product image'}
                fill
                className="object-cover"
              />

              {/* Main Badge */}
              {image.isMain && (
                <div className="absolute top-2 left-2 bg-[#FF5A1F] text-white px-2 py-1 rounded text-xs font-medium">
                  Main
                </div>
              )}

              {/* Overlay on Hover */}
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                {/* Drag Handle */}
                <div className="text-white cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-5 h-5" />
                </div>

                {/* Set Main Button */}
                <button
                  onClick={() => handleSetMain(image.id)}
                  disabled={settingMainId === image.id || isLoading}
                  className="text-white hover:text-yellow-300 disabled:opacity-50"
                  title="Set as main image"
                >
                  <Star
                    className="w-5 h-5"
                    fill={image.isMain ? 'currentColor' : 'none'}
                  />
                </button>

                {/* Delete Button */}
                <button
                  onClick={() => handleDelete(image.id)}
                  disabled={deletingId === image.id || isLoading}
                  className="text-white hover:text-red-300 disabled:opacity-50"
                  title="Delete image"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Order Number */}
            <div className="p-2 bg-white border-t">
              <p className="text-xs text-gray-600">
                Position {image.order + 1}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
