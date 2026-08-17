'use client'

import { useState } from 'react'
import { Button } from '@/components/UI/Button'
import { Marketplace } from '@/types/marketplace'
import { format } from 'date-fns'

interface MarketplaceConnectionsCardProps {
  connections: any[]
}

export function MarketplaceConnectionsCard({
  connections,
}: MarketplaceConnectionsCardProps) {
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const ebayConnection = connections.find(c => c.marketplaceId === 'ebay')
  const isEbayConnected = ebayConnection?.status === 'connected'
  const lastSync = ebayConnection?.syncLogs?.[0]

  const etsyConnection = connections.find(c => c.marketplaceId === 'etsy')
  const isEtsyConnected = etsyConnection?.status === 'connected'
  const etsyLastSync = etsyConnection?.syncLogs?.[0]

  const handleConnect = async (marketplace: string) => {
    setConnecting(marketplace)
    try {
      const response = await fetch(`/api/marketplace/connect/${marketplace}`)
      const data = await response.json()
      if (data.authUrl) {
        window.location.href = data.authUrl
      }
    } catch (error) {
      console.error('Failed to initiate connection:', error)
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
      </div>
    </div>
  )
}
