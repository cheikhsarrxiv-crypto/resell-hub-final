'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

/**
 * Hook pour récupérer le workspace courant de l'utilisateur
 * - Récupère tous les workspaces de l'utilisateur
 * - Retourne le premier workspace (workspace par défaut)
 * - Gère loading et erreurs
 */
export function useWorkspace() {
  const { data: session, status } = useSession();
  const [workspace, setWorkspace] = useState<any>(null);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }

    const fetchWorkspaces = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/workspaces');

        if (!response.ok) {
          throw new Error('Failed to fetch workspaces');
        }

        const data = await response.json();

        if (!data.success || !data.workspaces?.length) {
          throw new Error('No workspaces found');
        }

        setWorkspaces(data.workspaces);
        // ✅ Utiliser le premier workspace (ou le sélectionné)
        setWorkspace(data.workspaces[0]);
        setError(null);
      } catch (err) {
        console.error('[useWorkspace Error]', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setWorkspace(null);
        setWorkspaces([]);
      } finally {
        setLoading(false);
      }
    };

    fetchWorkspaces();
  }, [status]);

  return {
    workspace,
    workspaces,
    workspaceId: workspace?.id,
    loading,
    error,
    isReady: !loading && !!workspace,
  };
}

/**
 * Hook pour sélectionner un workspace spécifique
 */
export function useSelectWorkspace(workspaceId: string) {
  const { workspaces, loading } = useWorkspace();
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    if (loading || !workspaces.length) return;

    const ws = workspaces.find((w: any) => w.id === workspaceId);
    setSelected(ws || null);
  }, [workspaceId, workspaces, loading]);

  return {
    workspace: selected,
    workspaceId: selected?.id,
    isReady: !!selected,
  };
}
