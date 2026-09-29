import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AgentToolDefinition } from './types';

/**
 * AI-first listing workflow — lets the Agent know, BEFORE proposing where
 * to publish, which marketplaces this workspace can actually reach —
 * never guessing or defaulting to "eBay and Etsy" just because those are
 * the only two publish tools that exist. Mirrors the EXACT same
 * existence check publish_listing/publish_etsy_listing themselves use
 * (see actionTools.ts's own loadMarketplaceConnectionForPublish — a
 * plain `findFirst({ where: { workspaceId, marketplaceId } })`, never
 * filtered by status) so this tool can never disagree with what a real
 * publish attempt would actually do — no second, stricter/looser
 * definition of "connected" invented here.
 *
 * Only ever returns a safe allow-list (marketplace name/displayName +
 * whether a connection row exists + its own status string) — never
 * MarketplaceConnection's real columns (apiKey/apiSecret/
 * encryptedOauthToken/encryptedRefreshToken/accountEmail/etc.), same
 * security boundary get_listing/get_listings already enforce.
 */
export const getMarketplaceConnectionsTool: AgentToolDefinition<Record<string, never>> = {
  name: 'get_marketplace_connections',
  description:
    "Lists every marketplace ADKSY knows about, and whether the reseller's own workspace has a connection to it — use this BEFORE proposing which " +
    'marketplaces to publish a listing on, so you only ever offer marketplaces that are actually usable for this workspace right now. ' +
    "hasConnection is true only when a real MarketplaceConnection row exists for this workspace (the exact same check publish_listing/publish_etsy_listing " +
    "themselves make) — a marketplace with hasConnection: false has no publish tool available in ADKSY at all yet, OR simply isn't connected for this " +
    'workspace; either way, never propose publishing to it, and say plainly it is not connected/not available rather than attempting it. ' +
    'Never returns any credential/token — read-only, no side effect, never requires confirmation.',
  category: 'read',
  inputSchema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  async handler(workspaceId) {
    const [marketplaces, connections] = await Promise.all([
      prisma.marketplace.findMany({ select: { name: true, displayName: true, isAvailable: true } }),
      prisma.marketplaceConnection.findMany({
        where: { workspaceId },
        select: { marketplaceId: true, status: true },
      }),
    ]);

    const connectionByMarketplace = new Map(connections.map((c) => [c.marketplaceId, c.status]));

    // Only 'ebay'/'etsy' have a real publish tool today (publish_listing/
    // publish_etsy_listing) — never implied for any other marketplace name,
    // even if a Marketplace row for it exists (e.g. from onboarding data).
    const PUBLISHABLE_MARKETPLACE_NAMES = new Set(['ebay', 'etsy']);

    return {
      marketplaces: marketplaces.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        hasConnection: connectionByMarketplace.has(m.name),
        connectionStatus: connectionByMarketplace.get(m.name) ?? null,
        hasPublishTool: PUBLISHABLE_MARKETPLACE_NAMES.has(m.name),
      })),
    };
  },
};
