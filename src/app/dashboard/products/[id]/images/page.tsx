'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { ImageUploadZone } from '@/components/ImageUploadZone';
import { ImageGallery } from '@/components/ImageGallery';
import { ArrowLeft } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/StateComponents';

interface ProductImage {
  id: string;
  url: string;
  altText?: string;
  order: number;
  isMain: boolean;
}

export default function ProductImagesPage() {
  const { id: productId } = useParams();
  const { workspaceId, isReady } = useWorkspace();
  
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !workspaceId) return;
    fetchImages();
  }, [isReady, workspaceId, productId]);

  const fetchImages = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `/api/products/${productId}/images?workspaceId=${workspaceId}`
      );
      const data = await response.json();
      
      if (data.success) {
        setImages(data.images || []);
      } else {
        setError(data.error || 'Failed to load images');
      }
    } catch (err) {
      console.error('Failed to fetch images:', err);
      setError('An error occurred while loading images');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    setUploadError(null);

    try {
      // Upload each file
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`/api/products/${productId}/images`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Upload failed');
        }

        // Add to local state
        setImages((prev) => [...prev, data.image]);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (imageId: string) => {
    try {
      const response = await fetch(
        `/api/products/${productId}/images/${imageId}`,
        { method: 'DELETE' }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Delete failed');
      }
    } catch (err) {
      console.error('Delete error:', err);
      throw err;
    }
  };

  const handleReorder = async (
    imageOrder: Array<{ id: string; order: number; isMain: boolean }>
  ) => {
    try {
      const response = await fetch(
        `/api/products/${productId}/images/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: imageOrder }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Reorder failed');
      }
    } catch (err) {
      console.error('Reorder error:', err);
      throw err;
    }
  };

  const handleSetMain = async (imageId: string) => {
    try {
      const response = await fetch(
        `/api/products/${productId}/images/${imageId}/main`,
        { method: 'PUT' }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Set main failed');
      }
    } catch (err) {
      console.error('Set main error:', err);
      throw err;
    }
  };

  if (!isReady || loading) {
    return <LoadingState message="Loading images..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/dashboard/products/${productId}`}>
          <button className="text-[#FF5A1F] hover:text-[#e64f18] flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" />
            Back to Product
          </button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manage Images</h1>
        <p className="text-gray-600 mt-1">Upload and organize product photos</p>
      </div>

      {error && (
        <ErrorState
          message="Failed to load images"
          details={error}
          onRetry={fetchImages}
        />
      )}

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Images</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUploadZone
            onFilesSelected={handleUpload}
            isLoading={uploading}
            error={uploadError}
            multiple={true}
          />
        </CardContent>
      </Card>

      {/* Gallery Section */}
      <Card>
        <CardHeader>
          <CardTitle>Product Images ({images.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageGallery
            images={images}
            onDelete={handleDelete}
            onReorder={handleReorder}
            onSetMain={handleSetMain}
            isLoading={uploading}
            error={uploadError}
          />
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="bg-[#FF5A1F]/10 border-[#FF5A1F]/30">
        <CardHeader>
          <CardTitle className="text-[#14161A]">Tips</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-700 space-y-2">
          <p>• Drag images to reorder them</p>
          <p>• Click the star to set an image as main</p>
          <p>• Main image appears first when browsing</p>
          <p>• Maximum 10MB per image</p>
          <p>• Supported formats: JPEG, PNG, WebP, GIF</p>
        </CardContent>
      </Card>
    </div>
  );
}
