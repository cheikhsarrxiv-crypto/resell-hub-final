// Client-side helper to get workspace ID from slug
// This is cached to avoid multiple API calls

const workspaceCache = new Map<string, string>();

export async function getWorkspaceId(slug: string): Promise<string> {
  // Check cache first
  if (workspaceCache.has(slug)) {
    return workspaceCache.get(slug)!;
  }

  try {
    const response = await fetch('/api/workspaces');
    const data = await response.json();

    if (data.success && data.workspaces) {
      const workspace = data.workspaces.find((w: any) => w.slug === slug);
      
      if (workspace) {
        workspaceCache.set(slug, workspace.id);
        return workspace.id;
      }
    }

    throw new Error('Workspace not found');
  } catch (error) {
    console.error('Failed to get workspace ID:', error);
    throw error;
  }
}

export function clearWorkspaceCache() {
  workspaceCache.clear();
}
