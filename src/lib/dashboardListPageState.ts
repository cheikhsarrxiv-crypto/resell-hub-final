/**
 * Shared, framework-free state logic for dashboard list pages (Listings,
 * Orders). Two bugs this closes:
 *  - useWorkspace()'s `isReady` collapses "still loading" and "failed to
 *    load" into the same `false` value, so a page gated on `isReady` alone
 *    never calls its own fetch and its `loading` state (initialized true)
 *    is never flipped to false — an eternal "Loading..." spinner with no
 *    error and no retry whenever /api/workspaces fails or returns zero
 *    workspaces.
 *  - `if (data.success) { setItems(...) }` with no else silently falls
 *    back to an empty-list UI on any real API error (401/403/404/500)
 *    instead of surfacing it.
 *
 * Extracted here (rather than inlined per-page) so this decision logic is
 * unit-testable without a DOM — this project has no @testing-library/react
 * set up, and Vitest's default transform can't parse a .tsx file's JSX
 * directly (same reason marketplaceAvailability.ts is a plain module).
 */

export type WorkspaceReadiness =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

export function getWorkspaceReadiness(
  workspace: unknown,
  workspaceLoading: boolean,
  workspaceError: string | null
): WorkspaceReadiness {
  if (workspaceLoading) {
    return { status: 'loading' };
  }
  if (!workspace) {
    return { status: 'error', message: workspaceError || 'Unable to load your workspace. Please try again.' };
  }
  return { status: 'ready' };
}

export type ApiListResult<T> = { ok: true; items: T[] } | { ok: false; error: string };

export function parseApiListResponse<T>(
  responseOk: boolean,
  data: any,
  itemsKey: string,
  fallbackError: string
): ApiListResult<T> {
  if (!responseOk || !data?.success) {
    const serverError = data && typeof data.error === 'string' ? data.error : null;
    return { ok: false, error: serverError || fallbackError };
  }
  return { ok: true, items: Array.isArray(data[itemsKey]) ? data[itemsKey] : [] };
}

export type ListPageState = 'loading' | 'error' | 'empty' | 'list';

/**
 * A workspace-level error or an API-level error always wins over "empty"
 * — a real failure must never be presented as "you have nothing yet".
 */
export function getListPageState(
  workspaceReadiness: WorkspaceReadiness,
  loading: boolean,
  apiError: string | null,
  itemsCount: number
): ListPageState {
  if (workspaceReadiness.status === 'error') {
    return 'error';
  }
  if (apiError) {
    return 'error';
  }
  if (workspaceReadiness.status === 'loading' || loading) {
    return 'loading';
  }
  return itemsCount === 0 ? 'empty' : 'list';
}
