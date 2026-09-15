/**
 * Fix: ListingsPage/OrdersPage used to gate everything on useWorkspace()'s
 * `isReady`, which collapses "still loading" and "failed to load" into the
 * same `false` — so a failed /api/workspaces call (401/403/500, or a
 * workspace-less account) left the page's own `loading` state stuck at
 * its initial `true` forever: an eternal "Loading listings/orders..."
 * spinner, no error, no retry. And `if (data.success) {...}` with no
 * `else` silently fell back to the empty-list UI on any real API error.
 *
 * This tests the extracted, framework-free decision logic directly (no
 * DOM/@testing-library/react in this project — same convention as
 * marketplaceAvailability.ts). ListingsPage/OrdersPage are thin consumers
 * of these three functions.
 */
import { describe, it, expect } from 'vitest'
import { getWorkspaceReadiness, parseApiListResponse, getListPageState } from '@/lib/dashboardListPageState'

describe('getWorkspaceReadiness', () => {
  it('is "loading" while useWorkspace() is still fetching', () => {
    expect(getWorkspaceReadiness(null, true, null)).toEqual({ status: 'loading' })
  })

  it('is "error" with the real message once loading finished and no workspace exists — never stays "loading"', () => {
    expect(getWorkspaceReadiness(null, false, 'Email verification required')).toEqual({
      status: 'error',
      message: 'Email verification required',
    })
  })

  it('is "error" with a sensible fallback when useWorkspace() has no error message either', () => {
    expect(getWorkspaceReadiness(null, false, null)).toEqual({
      status: 'error',
      message: 'Unable to load your workspace. Please try again.',
    })
  })

  it('is "ready" once loading finished and a workspace exists', () => {
    expect(getWorkspaceReadiness({ id: 'ws-1' }, false, null)).toEqual({ status: 'ready' })
  })
})

describe('parseApiListResponse', () => {
  it('is an error when the HTTP response itself failed, using the server-provided message', () => {
    const result = parseApiListResponse<any>(false, { error: 'Unauthorized' }, 'listings', 'fallback')
    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('is an error when response.ok but data.success is false (the shape errorResponse() actually returns)', () => {
    const result = parseApiListResponse<any>(true, { error: 'Workspace not found or unauthorized' }, 'listings', 'fallback')
    expect(result).toEqual({ ok: false, error: 'Workspace not found or unauthorized' })
  })

  it('falls back to the given message when the server response has no error field', () => {
    const result = parseApiListResponse<any>(false, {}, 'listings', 'Failed to load listings. Please try again.')
    expect(result).toEqual({ ok: false, error: 'Failed to load listings. Please try again.' })
  })

  it('is ok with the real items on a genuine success', () => {
    const result = parseApiListResponse<any>(true, { success: true, listings: [{ id: 'l-1' }] }, 'listings', 'fallback')
    expect(result).toEqual({ ok: true, items: [{ id: 'l-1' }] })
  })

  it('is ok with an empty array on a genuine success with zero items — never treated as an error', () => {
    const result = parseApiListResponse<any>(true, { success: true, listings: [] }, 'listings', 'fallback')
    expect(result).toEqual({ ok: true, items: [] })
  })
})

describe('getListPageState', () => {
  const ready = { status: 'ready' as const }
  const workspaceLoading = { status: 'loading' as const }
  const workspaceErrorState = { status: 'error' as const, message: 'Unable to load your workspace. Please try again.' }

  it('is "loading" — never a false "error" or "empty" — while the workspace is still resolving', () => {
    expect(getListPageState(workspaceLoading, true, null, 0)).toBe('loading')
  })

  it('is "error", not "loading", when /api/workspaces failed — this is exactly the fix for the eternal spinner', () => {
    expect(getListPageState(workspaceErrorState, true, null, 0)).toBe('error')
  })

  it('is "error", not "empty", when the workspace is ready but the listings/orders API call failed', () => {
    expect(getListPageState(ready, false, 'Failed to load listings. Please try again.', 0)).toBe('error')
  })

  it('is "empty" — "No listings/orders yet" — only on a genuine success with zero items', () => {
    expect(getListPageState(ready, false, null, 0)).toBe('empty')
  })

  it('is "list" once ready, not loading, no error, and items exist', () => {
    expect(getListPageState(ready, false, null, 3)).toBe('list')
  })

  it('is "loading" while the page\'s own fetch is in flight, even though the workspace itself is ready', () => {
    expect(getListPageState(ready, true, null, 0)).toBe('loading')
  })
})
