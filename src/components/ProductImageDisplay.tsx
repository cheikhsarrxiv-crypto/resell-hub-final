'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ProductImage {
  id: string;
  url: string;
  isMain: boolean;
  order: number;
}

interface ProductImageDisplayProps {
  images: ProductImage[];
  productName: string;
}

export function ProductImageDisplay({
  images,
  productName,
}: ProductImageDisplayProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    // Set initial to main image
    const mainIndex = images.findIndex((img) => img.isMain);
    if (mainIndex !== -1) {
      setSelectedIndex(mainIndex);
    }
  }, [images]);

  if (!images || images.length === 0) {
    return (
      <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">No images</p>
          <p className="text-sm">Upload photos to see them here</p>
        </div>
      </div>
    );
  }

  const mainImage = images[selectedIndex];
  const hasMultiple = images.length > 1;

  return (
    <div className="space-y-4">
      {/* Main Image */}
      <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group">
        {mainImage && (
          <Image
            src={mainImage.url}
            alt={productName}
            fill
            className="object-cover"
          />
        )}

        {/* Navigation Buttons */}
        {hasMultiple && (
          <>
            <button
              onClick={() =>
                setSelectedIndex((prev) =>
                  prev === 0 ? images.length - 1 : prev - 1
                )
              }
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() =>
                setSelectedIndex((prev) =>
                  prev === images.length - 1 ? 0 : prev + 1
                )
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Next image"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Image Counter */}
            <div className="absolute bottom-2 right-2 bg-black/50 text-white px-3 py-1 rounded text-sm">
              {selectedIndex + 1} / {images.length}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {hasMultiple && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {images.map((image, index) => (
            <button
              key={image.id}
              onClick={() => setSelectedIndex(index)}
              className={`flex-shrink-0 w-16 h-16 relative rounded-lg overflow-hidden border-2 transition-all ${
                selectedIndex === index
                  ? 'border-[#FF5A1F]'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Image
                src={image.url}
                alt={`${productName} ${index + 1}`}
                fill
                className="object-cover"
              />
              {image.isMain && (
                <div className="absolute top-1 left-1 bg-[#FF5A1F] text-white text-xs px-1.5 py-0.5 rounded">
                  Main
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
