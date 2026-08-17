'use client';

import { Button } from './UI/Button';
import { AlertCircle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  danger = false,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className={`p-6 ${danger ? 'bg-red-50' : ''}`}>
          <div className="flex items-center gap-3 mb-4">
            {danger && <AlertCircle className="w-6 h-6 text-red-600" />}
            <h2 className={`text-lg font-bold ${danger ? 'text-red-900' : 'text-gray-900'}`}>
              {title}
            </h2>
          </div>
          <p className={danger ? 'text-red-800' : 'text-gray-700'}>{message}</p>
        </div>

        <div className="flex gap-3 px-6 py-4 bg-gray-50 rounded-b-lg border-t border-gray-200">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className="flex-1"
          >
            {cancelText}
          </Button>
          <Button
            variant={danger ? 'outline' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 ${danger ? 'text-red-600 border-red-300 hover:bg-red-50' : ''}`}
          >
            {loading ? 'Processing...' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
