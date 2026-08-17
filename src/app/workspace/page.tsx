'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';
import { Card, CardContent } from '@/components/UI/Card';
import { Plus, ArrowRight } from 'lucide-react';

export default function WorkspacePage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    try {
      // Get user's first workspace
      const response = await fetch('/api/workspaces');
      const data = await response.json();
      
      if (data.success && data.workspaces && data.workspaces.length > 0) {
        // Redirect to the main dashboard (complete implementation)
        router.push('/dashboard');
      } else {
        // Show workspace selection or creation
        setWorkspaces(data.workspaces || []);
      }
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <div className="h-12 w-12 border-4 border-blue-200 border-t-blue-600 rounded-full"></div>
          </div>
          <p className="text-gray-600">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Select Workspace</h1>
          <p className="text-gray-600 mt-2">Choose a workspace to continue</p>
        </div>

        {workspaces.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-gray-600 mb-6">No workspaces found. Creating one...</p>
              <Button variant="primary" onClick={() => router.push('/dashboard')}>
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {workspaces.map((workspace) => (
              <Card
                key={workspace.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/workspace/${workspace.slug}`)}
              >
                <CardContent className="p-6 flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{workspace.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Plan: {workspace.subscription?.plan?.displayName || 'Free'}
                    </p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-blue-600" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-8">
          <Link href="/api/auth/signout" className="text-blue-600 hover:text-blue-700">
            Sign out
          </Link>
        </div>
      </div>
    </div>
  );
}
