'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { DashboardButton } from '@/components/dashboard/DashboardButton'
import { Marketplace } from '@/types/marketplace'
import { format } from 'date-fns'

interface MarketplaceConnectionsCardProps {
  connections: any[]
}

const MARKETPLACE_DISPLAY_NAMES: Record<string, string> = {
  ebay: 'eBay',
  etsy: 'Etsy',
}

/**
 * Pure decision logic for handleConnect(), pulled out so it can be unit
 * tested directly (no DOM/component rendering needed — this repo's
 * Vitest config runs in the 'node' environment). fetch() only rejects on
 * a network-level failure: a 4xx/5xx response (with a JSON {error: ...}
 * body) or a 200 that's unexpectedly missing authUrl both resolve
 * normally and must be treated as failures here, not silently ignored.
 */
export function resolveConnectOutcome(
  response: Response,
  data: { authUrl?: string; error?: string }
): { ok: true; authUrl: string } | { ok: false; message: string } {
  if (response.ok && data.authUrl) {
    return { ok: true, authUrl: data.authUrl }
  }
  return {
    ok: false,
    message: data.error || 'Failed to start the connection. Please try again.',
  }
}

/**
 * Pure decision logic for turning a raw MarketplaceConnection.status value
 * (whatever the database actually holds — today: 'connected', 'expired',
 * 'not_connected', or no connection row at all) into the three display
 * states this card actually renders differently. Pulled out for the same
 * reason resolveConnectOutcome()/resolveCallbackNotice() are: testable
 * without rendering.
 *
 * 'connected' is returned ONLY for the literal string 'connected' — this
 * card must never show "Connected" for an expired, not-yet-connected, or
 * any future/unrecognized status value. Anything that isn't exactly
 * 'connected' or 'expired' (including undefined/no connection row) falls
 * back to 'not_connected', preserving the card's pre-existing behavior for
 * every status other than 'expired'.
 */
export function resolveDisplayStatus(status: string | undefined): 'connected' | 'expired' | 'not_connected' {
  if (status === 'connected') return 'connected'
  if (status === 'expired') return 'expired'
  return 'not_connected'
}

/**
 * Pure decision logic for interpreting the OAuth callback's redirect
 * query params (?status=connected&marketplace=ebay or
 * ?status=error&error=...) into a one-time notice to show the user.
 * Pulled out for the same reason as resolveConnectOutcome() above:
 * testable without rendering.
 *
 * Unknown/malformed values are ignored rather than guessed at — no
 * message is safer than a wrong one. Note the OAuth callback's redirect
 * only ever includes `marketplace` on the success case, never on an
 * error one, so error messages are intentionally not attributed to a
 * specific marketplace card here.
 */
export function resolveCallbackNotice(
  status: string | null,
  marketplaceParam: string | null,
  errorParam: string | null
): { type: 'success' | 'error'; message: string } | null {
  if (status === 'connected') {
    const displayName = marketplaceParam ? MARKETPLACE_DISPLAY_NAMES[marketplaceParam] : undefined
    if (!displayName) return null
    return { type: 'success', message: `${displayName} connected successfully.` }
  }

  if (status === 'error') {
    return {
      type: 'error',
      message: errorParam || 'Something went wrong connecting your marketplace account.',
    }
  }

  return null
}

export function MarketplaceConnectionsCard({
  connections,
}: MarketplaceConnectionsCardProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Computed once from the URL this component first mounted with (lazy
  // initializer), before the params are stripped below — a refresh must
  // not re-show this, and router.replace() changing the URL must not
  // re-trigger this computation.
  const [callbackNotice] = useState(() =>
    resolveCallbackNotice(
      searchParams.get('status'),
      searchParams.get('marketplace'),
      searchParams.get('error')
    )
  )

  useEffect(() => {
    if (callbackNotice) {
      // Strip the one-time OAuth callback params so a page refresh (or
      // back/forward navigation) doesn't re-display the same notice.
      router.replace(pathname)
    }
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<{ marketplace: string; message: string } | null>(null)

  const ebayConnection = connections.find(c => c.marketplaceId === 'ebay')
  const ebayDisplayStatus = resolveDisplayStatus(ebayConnection?.status)
  const isEbayConnected = ebayDisplayStatus === 'connected'
  const isEbayExpired = ebayDisplayStatus === 'expired'
  const lastSync = ebayConnection?.syncLogs?.[0]

  const etsyConnection = connections.find(c => c.marketplaceId === 'etsy')
  const etsyDisplayStatus = resolveDisplayStatus(etsyConnection?.status)
  const isEtsyConnected = etsyDisplayStatus === 'connected'
  const isEtsyExpired = etsyDisplayStatus === 'expired'
  const etsyLastSync = etsyConnection?.syncLogs?.[0]

  const handleConnect = async (marketplace: string) => {
    setConnecting(marketplace)
    setConnectError(null)
    try {
      const response = await fetch(`/api/marketplace/connect/${marketplace}`)
      const data = await response.json()
      const outcome = resolveConnectOutcome(response, data)

      if (!outcome.ok) {
        setConnectError({ marketplace, message: outcome.message })
        setConnecting(null)
        return
      }

      window.location.href = outcome.authUrl
    } catch (error) {
      console.error('Failed to initiate connection:', error)
      setConnectError({
        marketplace,
        message: 'Failed to start the connection. Please try again.',
      })
      setConnecting(null)
    }
  }

  const handleDisconnect = async (marketplace: string) => {
    setDisconnecting(marketplace)
    try {
      await fetch(`/api/marketplace/disconnect/${marketplace}`, {
        method: 'POST',
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to disconnect:', error)
      setDisconnecting(null)
    }
  }

  return (
    <div className="space-y-4">
      {callbackNotice && (
        <div
          className={
            callbackNotice.type === 'success'
              ? 'p-4 bg-[#FF5A1F]/10 rounded-xl border border-[#FF5A1F]/20'
              : 'p-4 bg-red-500/10 rounded-xl border border-red-500/20'
          }
        >
          <p className={callbackNotice.type === 'success' ? 'text-sm text-gray-200' : 'text-sm text-red-300'}>
            {callbackNotice.message}
          </p>
        </div>
      )}

      {/* eBay */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">eBay</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">eBay</h2>
              <p className="text-gray-500 text-sm">Sell your products on eBay</p>
            </div>
          </div>

          {isEbayConnected ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
                {lastSync ? (
                  <span className="text-xs text-gray-500 mt-1">
                    Last sync: {format(new Date(lastSync.createdAt), 'MMM dd, HH:mm')}
                  </span>
                ) : ebayConnection?.createdAt ? (
                  <span className="text-xs text-gray-500 mt-1">
                    Connected {format(new Date(ebayConnection.createdAt), 'MMM dd, yyyy')}
                  </span>
                ) : null}
              </div>
              <DashboardButton
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect('ebay')}
                disabled={disconnecting === 'ebay'}
              >
                {disconnecting === 'ebay' ? 'Disconnecting...' : 'Disconnect'}
              </DashboardButton>
            </div>
          ) : isEbayExpired ? (
            <div className="flex items-center gap-3">
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-400"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Expired — reconnection required
              </span>
              <DashboardButton
                variant="primary"
                onClick={() => handleConnect('ebay')}
                disabled={connecting === 'ebay'}
              >
                {connecting === 'ebay' ? 'Connecting...' : 'Reconnect to eBay'}
              </DashboardButton>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                Disconnected
              </span>
              <DashboardButton
                variant="primary"
                onClick={() => handleConnect('ebay')}
                disabled={connecting === 'ebay'}
              >
                {connecting === 'ebay' ? 'Connecting...' : 'Connect to eBay'}
              </DashboardButton>
            </div>
          )}
        </div>

        {isEbayConnected && (
          <div className="mt-4 p-4 bg-[#FF5A1F]/10 rounded-xl border border-[#FF5A1F]/20">
            <p className="text-sm text-gray-200">
              Your eBay account is connected. You can now sync listings and orders.
            </p>
          </div>
        )}

        {isEbayExpired && (
          <div className="mt-4 p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <p className="text-sm text-amber-300">
              Your eBay connection has expired. Reconnect to resume syncing listings and orders.
            </p>
          </div>
        )}

        {connectError?.marketplace === 'ebay' && (
          <div className="mt-4 p-4 bg-red-500/10 rounded-xl border border-red-500/20">
            <p className="text-sm text-red-300">{connectError.message}</p>
          </div>
        )}
      </div>

      {/* Etsy */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F1641E]/90 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">Etsy</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Etsy</h2>
              <p className="text-gray-500 text-sm">Sell your products on Etsy</p>
            </div>
          </div>

          {isEtsyConnected ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
                {etsyLastSync ? (
                  <span className="text-xs text-gray-500 mt-1">
                    Last sync: {format(new Date(etsyLastSync.createdAt), 'MMM dd, HH:mm')}
                  </span>
                ) : etsyConnection?.createdAt ? (
                  <span className="text-xs text-gray-500 mt-1">
                    Connected {format(new Date(etsyConnection.createdAt), 'MMM dd, yyyy')}
                  </span>
                ) : null}
              </div>
              <DashboardButton
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect('etsy')}
                disabled={disconnecting === 'etsy'}
              >
                {disconnecting === 'etsy' ? 'Disconnecting...' : 'Disconnect'}
              </DashboardButton>
            </div>
          ) : isEtsyExpired ? (
            <div className="flex items-center gap-3">
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-400"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Expired — reconnection required
              </span>
              <DashboardButton
                variant="primary"
                onClick={() => handleConnect('etsy')}
                disabled={connecting === 'etsy'}
              >
                {connecting === 'etsy' ? 'Connecting...' : 'Reconnect to Etsy'}
              </DashboardButton>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                Disconnected
              </span>
              <DashboardButton
                variant="primary"
                onClick={() => handleConnect('etsy')}
                disabled={connecting === 'etsy'}
              >
                {connecting === 'etsy' ? 'Connecting...' : 'Connect to Etsy'}
              </DashboardButton>
            </div>
          )}
        </div>

        {isEtsyConnected && (
          <div className="mt-4 p-4 bg-[#FF5A1F]/10 rounded-xl border border-[#FF5A1F]/20">
            <p className="text-sm text-gray-200">
              Your Etsy account is connected. You can now sync listings and orders.
            </p>
          </div>
        )}

        {isEtsyExpired && (
          <div className="mt-4 p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <p className="text-sm text-amber-300">
              Your Etsy connection has expired. Reconnect to resume syncing listings and orders.
            </p>
          </div>
        )}

        {connectError?.marketplace === 'etsy' && (
          <div className="mt-4 p-4 bg-red-500/10 rounded-xl border border-red-500/20">
            <p className="text-sm text-red-300">{connectError.message}</p>
          </div>
        )}
      </div>
    </div>
  )
}
