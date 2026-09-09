'use client';

import { DashboardButton } from './dashboard/DashboardButton';
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-[#0d0d10] border border-white/10 rounded-2xl shadow-2xl max-w-md w-full">
        <div className={`p-6 ${danger ? 'bg-red-500/[0.04] rounded-t-2xl' : ''}`}>
          <div className="flex items-center gap-3 mb-4">
            {danger && <AlertCircle className="w-5 h-5 text-red-400" />}
            <h2 className={`text-lg font-bold ${danger ? 'text-red-300' : 'text-white'}`}>{title}</h2>
          </div>
          <p className={danger ? 'text-red-200/70' : 'text-gray-400'}>{message}</p>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/[0.06]">
          <DashboardButton variant="outline" onClick={onCancel} disabled={loading} className="flex-1">
            {cancelText}
          </DashboardButton>
          <DashboardButton
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Processing...' : confirmText}
          </DashboardButton>
        </div>
      </div>
    </div>
  );
}
