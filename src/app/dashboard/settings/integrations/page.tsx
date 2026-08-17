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
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Marketplace Integrations</h1>
        <p className="text-gray-600 mt-2">Connect and manage your marketplace accounts</p>
      </div>

      <div className="grid gap-6">
        <MarketplaceConnectionsCard connections={connections} />
      </div>
    </div>
  )
}
