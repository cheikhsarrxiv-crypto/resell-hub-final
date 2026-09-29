'use client'

import { useState } from 'react'
import { DashboardButton } from '@/components/dashboard/DashboardButton'

export interface ManualCredentialField {
  /** Exact key sent in the request body's `credentials` object — e.g. 'accessKey'. */
  name: string
  /** User-facing label for this field's input. */
  label: string
  /** Defaults to 'password' — these are secrets, never shown in plain text by default. */
  type?: 'text' | 'password'
}

interface ManualCredentialConnectFormProps {
  /** Marketplace path segment, e.g. 'vinted' — used in the request URL only. */
  marketplace: string
  fields: ManualCredentialField[]
  onConnected?: () => void
}

/**
 * Pure decision logic for the manual-credential connect form's submit
 * outcome, pulled out for the same reason MarketplaceConnectionsCard's
 * own resolveConnectOutcome() is: unit-testable without rendering (this
 * repo's Vitest config runs in the 'node' environment). A non-ok response
 * or a 200 response that isn't the expected {status: 'connected', ...}
 * shape are both treated as failures here — never silently ignored.
 */
export function resolveManualConnectOutcome(
  response: Response,
  data: { status?: string; error?: string }
): { ok: true } | { ok: false; message: string } {
  if (response.ok && data.status === 'connected') {
    return { ok: true }
  }
  return {
    ok: false,
    message: data.error || 'Failed to connect. Please check your credentials and try again.',
  }
}

/**
 * Generic, reusable form for marketplaces with no OAuth flow at all (see
 * ManualCredentialConnectable, src/types/marketplace.ts) — the workspace
 * pastes credentials generated elsewhere (e.g. Vinted's own Pro portal)
 * directly here, POSTed to /api/marketplace/connect-manual/[marketplace].
 *
 * Field values are only ever held in local component state and sent once
 * on submit — never logged, never persisted client-side (no draft
 * autosave, no localStorage), and the inputs default to type="password"
 * so they're not shown in plain text by default either.
 *
 * NOT wired into MarketplaceConnectionsCard/the Integrations page yet —
 * see this component's own call sites (currently none in the rendered
 * app) — Vinted must not appear as a real, connectable option until real
 * Vinted Pro Integrations access is actually obtained (multi-marketplace
 * auth architecture audit's own explicit constraint).
 */
export function ManualCredentialConnectForm({
  marketplace,
  fields,
  onConnected,
}: ManualCredentialConnectFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/marketplace/connect-manual/${marketplace}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: values }),
      })
      const data = await response.json().catch(() => ({}))
      const outcome = resolveManualConnectOutcome(response, data)

      if (!outcome.ok) {
        setError(outcome.message)
        setSubmitting(false)
        return
      }

      setValues({})
      setSubmitting(false)
      onConnected?.()
    } catch {
      setError('Failed to connect. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={`manual-credential-${marketplace}-${field.name}`} className="block text-sm text-gray-400 mb-1">
            {field.label}
          </label>
          <input
            id={`manual-credential-${marketplace}-${field.name}`}
            type={field.type ?? 'password'}
            autoComplete="off"
            value={values[field.name] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.1] px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/60"
            required
          />
        </div>
      ))}

      {error && (
        <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <DashboardButton type="submit" variant="primary" size="sm" disabled={submitting}>
        {submitting ? 'Connecting...' : 'Connect'}
      </DashboardButton>
    </form>
  )
}

export default ManualCredentialConnectForm
