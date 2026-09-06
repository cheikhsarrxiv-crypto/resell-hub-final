'use client'

import { useState } from 'react'
import { Button } from '@/components/UI/Button'
import { Marketplace } from '@/types/marketplace'
import { format } from 'date-fns'

interface MarketplaceConnectionsCardProps {
  connections: any[]
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

export function MarketplaceConnectionsCard({
  connections,
}: MarketplaceConnectionsCardProps) {
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<{ marketplace: string; message: string } | null>(null)

  const ebayConnection = connections.find(c => c.marketplaceId === 'ebay')
  const isEbayConnected = ebayConnection?.status === 'connected'
  const lastSync = ebayConnection?.syncLogs?.[0]

  const etsyConnection = connections.find(c => c.marketplaceId === 'etsy')
  const isEtsyConnected = etsyConnection?.status === 'connected'
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
      {/* eBay — unchanged */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#14161A] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">eBay</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#14161A]">eBay</h2>
              <p className="text-gray-500 text-sm">Sell your products on eBay</p>
            </div>
          </div>

          {isEbayConnected ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect('ebay')}
                disabled={disconnecting === 'ebay'}
              >
                {disconnecting === 'ebay' ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                Disconnected
              </span>
              <Button
                onClick={() => handleConnect('ebay')}
                disabled={connecting === 'ebay'}
              >
                {connecting === 'ebay' ? 'Connecting...' : 'Connect to eBay'}
              </Button>
            </div>
          )}
        </div>

        {isEbayConnected && (
          <div className="mt-4 p-4 bg-[#FF5A1F]/10 rounded border border-[#FF5A1F]/30">
            <p className="text-sm text-[#14161A]">
              Your eBay account is connected. You can now sync listings and orders.
            </p>
          </div>
        )}

        {connectError?.marketplace === 'ebay' && (
          <div className="mt-4 p-4 bg-red-50 rounded border border-red-200">
            <p className="text-sm text-red-700">{connectError.message}</p>
          </div>
        )}
      </div>

      {/* Etsy */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#F1641E] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">Etsy</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#14161A]">Etsy</h2>
              <p className="text-gray-500 text-sm">Sell your products on Etsy</p>
            </div>
          </div>

          {isEtsyConnected ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect('etsy')}
                disabled={disconnecting === 'etsy'}
              >
                {disconnecting === 'etsy' ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                Disconnected
              </span>
              <Button
                onClick={() => handleConnect('etsy')}
                disabled={connecting === 'etsy'}
              >
                {connecting === 'etsy' ? 'Connecting...' : 'Connect to Etsy'}
              </Button>
            </div>
          )}
        </div>

        {isEtsyConnected && (
          <div className="mt-4 p-4 bg-[#FF5A1F]/10 rounded border border-[#FF5A1F]/30">
            <p className="text-sm text-[#14161A]">
              Your Etsy account is connected. You can now sync listings and orders.
            </p>
          </div>
        )}

        {connectError?.marketplace === 'etsy' && (
          <div className="mt-4 p-4 bg-red-50 rounded border border-red-200">
            <p className="text-sm text-red-700">{connectError.message}</p>
          </div>
        )}
      </div>
    </div>
  )
}
