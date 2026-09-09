'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState, DashboardErrorState } from '@/components/dashboard/DashboardStates';
import { ConfirmModal } from '@/components/ConfirmModal';

const inputClass =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#FF5A1F]/50 focus:border-[#FF5A1F]/50';

export default function SettingsPage() {
  const router = useRouter();
  const { workspace, isReady } = useWorkspace();
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceDescription, setWorkspaceDescription] = useState('');
  const [country, setCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (workspace) {
      setWorkspaceName(workspace.name || '');
      setWorkspaceDescription(workspace.description || '');
      setCountry(workspace.country || '');
    }
  }, [workspace]);

  const handleDeleteWorkspace = async () => {
    if (!workspace?.id) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}?workspaceId=${workspace.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setShowDeleteModal(false);
        router.push('/login');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete workspace');
        setShowDeleteModal(false);
      }
    } catch (err) {
      console.error('Failed to delete workspace:', err);
      setError('An error occurred while deleting the workspace');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!workspace?.id) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workspaceName,
          description: workspaceDescription,
          country,
        }),
      });

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save settings');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('An error occurred while saving');
    } finally {
      setSaving(false);
    }
  };

  if (!isReady) {
    return <DashboardLoadingState message="Loading settings..." />;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Settings" description="Manage your workspace settings" />

      {/* Success Message */}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-4 py-3 rounded-lg text-sm">
          ✓ Settings saved successfully
        </div>
      )}

      {/* Error Message */}
      {error && <DashboardErrorState message="Error" details={error || undefined} />}

      {/* Workspace Info */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Workspace Information</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Workspace Name</label>
            <input
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Description</label>
            <textarea
              value={workspaceDescription}
              onChange={(e) => setWorkspaceDescription(e.target.value)}
              rows={4}
              className={inputClass}
              placeholder="Describe your reselling business..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Country</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass}>
              <option value="" className="bg-[#0d0d10]">Select country</option>
              <option value="FR" className="bg-[#0d0d10]">France</option>
              <option value="DE" className="bg-[#0d0d10]">Germany</option>
              <option value="UK" className="bg-[#0d0d10]">United Kingdom</option>
              <option value="US" className="bg-[#0d0d10]">United States</option>
              <option value="OTHER" className="bg-[#0d0d10]">Other</option>
            </select>
          </div>

          <DashboardButton variant="primary" onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
            {saving ? 'Saving...' : 'Save Changes'}
          </DashboardButton>
        </DashboardCardContent>
      </DashboardCard>

      {/* Workspace ID */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Workspace ID</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          <div className="bg-white/[0.04] border border-white/[0.06] p-3 rounded-lg font-mono text-sm text-gray-400 break-all">
            {workspace?.id}
          </div>
          <p className="text-xs text-gray-600 mt-2">Use this ID for API calls</p>
        </DashboardCardContent>
      </DashboardCard>

      {/* Danger Zone */}
      <DashboardCard className="border-red-500/20 bg-red-500/[0.03]">
        <DashboardCardHeader>
          <DashboardCardTitle className="text-red-300">Danger Zone</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          <p className="text-sm text-red-200/70 mb-4">
            Deleting this workspace will permanently remove all data. This action cannot be undone.
          </p>
          <DashboardButton variant="danger" onClick={() => setShowDeleteModal(true)}>
            Delete Workspace
          </DashboardButton>
        </DashboardCardContent>
      </DashboardCard>

      {/* Delete Modal */}
      <ConfirmModal
        isOpen={showDeleteModal}
        title="Delete Workspace"
        message="Are you sure you want to delete this workspace? All data will be permanently removed and cannot be recovered."
        danger
        confirmText={deleting ? 'Deleting...' : 'Delete'}
        onConfirm={handleDeleteWorkspace}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
