/**
 * /settings/integrations
 * Marketplace connections management
 */

import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { MarketplaceConnectionsCard } from '@/components/marketplace/MarketplaceConnectionsCard'
import { marketplaceConnectionPublicSelect } from '@/lib/marketplaceConnectionPublicSelect'

export default async function IntegrationsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/login')
  }

  const workspaceId = session.user.workspaceId || 'default'

  // Get marketplace connections. These rows are passed as props to a
  // client component, so Next.js serializes them into the page payload:
  // only the public allowlist may be selected — never apiKey, apiSecret or
  // the encrypted OAuth tokens.
  const connections = await prisma.marketplaceConnection.findMany({
    where: { workspaceId },
    select: {
      ...marketplaceConnectionPublicSelect,
      syncLogs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
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
