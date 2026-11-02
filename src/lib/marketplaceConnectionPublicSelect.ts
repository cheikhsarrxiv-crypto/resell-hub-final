import type { Prisma } from '@prisma/client'

/**
 * Fields of a MarketplaceConnection that are safe to send to the browser.
 *
 * Every route or Server Component that hands connection rows to client code
 * (a JSON response, or props passed into a 'use client' component, which
 * Next.js serializes into the page payload) must use this select instead of
 * returning whole rows. Whole rows include apiKey, apiSecret,
 * encryptedOauthToken, encryptedRefreshToken, accountEmail and
 * tokenExpiresAt — none of which the UI needs, and none of which may ever
 * leave the server, even encrypted.
 *
 * Allowlist on purpose: a new column added to the model later stays
 * server-side until someone deliberately adds it here.
 */
export const marketplaceConnectionPublicSelect = {
  id: true,
  marketplaceId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastSyncAt: true,
  marketplace: {
    select: {
      name: true,
      displayName: true,
    },
  },
} satisfies Prisma.MarketplaceConnectionSelect

export type MarketplaceConnectionPublic = Prisma.MarketplaceConnectionGetPayload<{
  select: typeof marketplaceConnectionPublicSelect
}>
