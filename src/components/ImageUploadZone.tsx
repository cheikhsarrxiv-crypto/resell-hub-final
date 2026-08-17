'use client';

import { useCallback, useState, useRef } from 'react';
import { Upload, X, Loader } from 'lucide-react';
import Image from 'next/image';

interface ImageUploadZoneProps {
  onFilesSelected: (files: File[]) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  multiple?: boolean;
}

export function ImageUploadZone({
  onFilesSelected,
  isLoading = false,
  error = null,
  multiple = true,
}: ImageUploadZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [previews, setPreviews] = useState<Array<{ file: File; preview: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFiles = (files: FileList | File[]): File[] => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    const validFiles: File[] = [];

    Array.from(files).forEach((file) => {
      if (!allowedTypes.includes(file.type)) {
        console.warn(`File ${file.name} has invalid type: ${file.type}`);
        return;
      }
      if (file.size > maxSize) {
        console.warn(`File ${file.name} is too large: ${file.size} bytes`);
        return;
      }
      validFiles.push(file);
    });

    return validFiles;
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      const validFiles = validateFiles(files);
      if (validFiles.length === 0) {
        return;
      }

      // Update previews
      const newPreviews = validFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));

      if (!multiple) {
        setPreviews(newPreviews);
      } else {
        setPreviews((prev) => [...prev, ...newPreviews]);
      }

      // Upload files
      try {
        await onFilesSelected(validFiles);
        // Clear previews after successful upload
        setPreviews([]);
      } catch (err) {
        console.error('Upload failed:', err);
        // Keep previews so user can see what failed
      }
    },
    [onFilesSelected, multiple]
  );

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const removePreview = (index: number) => {
    setPreviews((prev) => {
      const newPreviews = [...prev];
      URL.revokeObjectURL(newPreviews[index].preview);
      newPreviews.splice(index, 1);
      return newPreviews;
    });
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragActive
            ? 'border-[#FF5A1F] bg-[#FF5A1F]/10'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
        } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={() => !isLoading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept="image/*"
          onChange={handleChange}
          disabled={isLoading}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-2">
          {isLoading ? (
            <Loader className="w-8 h-8 text-[#FF5A1F] animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-gray-400" />
          )}
          <p className="font-medium text-gray-900">
            {isDragActive ? 'Drop images here' : 'Drag images here or click to select'}
          </p>
          <p className="text-sm text-gray-600">
            PNG, JPEG, WebP, GIF up to 10MB
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Previews */}
      {previews.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            {previews.length} image{previews.length !== 1 ? 's' : ''} selected
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {previews.map((item, index) => (
              <div key={index} className="relative group">
                <div className="aspect-square relative bg-gray-100 rounded-lg overflow-hidden">
                  <Image
                    src={item.preview}
                    alt={`Preview ${index + 1}`}
                    fill
                    className="object-cover"
                  />
                </div>
                <button
                  onClick={() => removePreview(index)}
                  disabled={isLoading}
                  className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
                <p className="mt-1 text-xs text-gray-600 truncate">
                  {item.file.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
