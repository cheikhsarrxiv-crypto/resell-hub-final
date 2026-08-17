'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { LoadingState, ErrorState } from '@/components/StateComponents';

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
    return <LoadingState message="Loading settings..." />;
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your workspace settings</p>
      </div>

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          ✓ Settings saved successfully
        </div>
      )}

      {/* Error Message */}
      {error && <ErrorState message="Error" details={error || undefined} />}

      {/* Workspace Info */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Workspace Name
            </label>
            <input
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={workspaceDescription}
              onChange={(e) => setWorkspaceDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Describe your reselling business..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Country
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select country</option>
              <option value="FR">France</option>
              <option value="DE">Germany</option>
              <option value="UK">United Kingdom</option>
              <option value="US">United States</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {/* Workspace ID */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace ID</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-100 p-3 rounded font-mono text-sm text-gray-600 break-all">
            {workspace?.id}
          </div>
          <p className="text-xs text-gray-600 mt-2">Use this ID for API calls</p>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-900">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-800 mb-4">
            Deleting this workspace will permanently remove all data. This action cannot be undone.
          </p>
          <Button
            variant="outline"
            className="text-red-600 border-red-300 hover:bg-red-100"
            onClick={() => setShowDeleteModal(true)}
          >
            Delete Workspace
          </Button>
        </CardContent>
      </Card>

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
