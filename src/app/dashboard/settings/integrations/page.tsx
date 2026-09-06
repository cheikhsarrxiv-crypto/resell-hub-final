/**
 * /settings/integrations
 * Marketplace connections management
 */

import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { MarketplaceConnectionsCard } from '@/components/marketplace/MarketplaceConnectionsCard'

export default async function IntegrationsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/login')
  }

  const workspaceId = session.user.workspaceId || 'default'

  // Get marketplace connections
  const connections = await prisma.marketplaceConnection.findMany({
    where: { workspaceId },
    include: {
      marketplace: true,
      syncLogs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
      },
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-2xl sm:text-3xl font-bold text-white tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Marketplace Integrations
        </h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">Connect and manage your marketplace accounts</p>
      </div>

      <MarketplaceConnectionsCard connections={connections} />
    </div>
  )
}
