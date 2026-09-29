/**
 * AI-first listing workflow — behavioral tests for
 * get_marketplace_connections: a read-only tool that must mirror the
 * EXACT same "is this marketplace connected" check publish_listing/
 * publish_etsy_listing themselves use (loadMarketplaceConnectionForPublish
 * in actionTools.ts — a plain existence check, never filtered by status),
 * and must never leak a MarketplaceConnection's real credential columns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { marketplaceFindManyMock, connectionFindManyMock } = vi.hoisted(() => ({
  marketplaceFindManyMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplace: { findMany: marketplaceFindManyMock },
    marketplaceConnection: { findMany: connectionFindManyMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getMarketplaceConnectionsTool } from '@/services/ai/tools/marketplaceTools';

describe('get_marketplace_connections', () => {
  beforeEach(() => {
    marketplaceFindManyMock.mockReset();
    connectionFindManyMock.mockReset();
  });

  it('is registered as a "read" tool (auto-executed, never confirmation-gated)', () => {
    expect(AiToolRegistry.get('get_marketplace_connections')?.category).toBe('read');
  });

  it('costs 1 AI Unit — same tier as get_listing/get_order', async () => {
    const { getToolUsageUnits } = await import('@/services/ai/aiUsageConfig');
    expect(getToolUsageUnits('get_marketplace_connections')).toBe(1);
  });

  it('reports hasConnection true only for a marketplace with a real MarketplaceConnection row for this workspace', async () => {
    marketplaceFindManyMock.mockResolvedValue([
      { name: 'ebay', displayName: 'eBay', isAvailable: true },
      { name: 'etsy', displayName: 'Etsy', isAvailable: true },
      { name: 'depop', displayName: 'Depop', isAvailable: true },
    ]);
    connectionFindManyMock.mockResolvedValue([{ marketplaceId: 'ebay', status: 'connected' }]);

    const result: any = await getMarketplaceConnectionsTool.handler('ws-1', {}, { conversationId: 'conv-1', userId: 'user-1' });

    expect(connectionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'ws-1' } }));
    const ebay = result.marketplaces.find((m: any) => m.name === 'ebay');
    const etsy = result.marketplaces.find((m: any) => m.name === 'etsy');
    const depop = result.marketplaces.find((m: any) => m.name === 'depop');

    expect(ebay.hasConnection).toBe(true);
    expect(ebay.connectionStatus).toBe('connected');
    expect(etsy.hasConnection).toBe(false);
    expect(etsy.connectionStatus).toBeNull();
    expect(depop.hasConnection).toBe(false);
  });

  it('hasPublishTool is true ONLY for ebay/etsy, even when a connection row exists for another marketplace', async () => {
    marketplaceFindManyMock.mockResolvedValue([
      { name: 'ebay', displayName: 'eBay', isAvailable: true },
      { name: 'etsy', displayName: 'Etsy', isAvailable: true },
      { name: 'vinted', displayName: 'Vinted', isAvailable: true },
    ]);
    connectionFindManyMock.mockResolvedValue([{ marketplaceId: 'vinted', status: 'connected' }]);

    const result: any = await getMarketplaceConnectionsTool.handler('ws-1', {}, { conversationId: 'conv-1', userId: 'user-1' });

    const vinted = result.marketplaces.find((m: any) => m.name === 'vinted');
    expect(vinted.hasConnection).toBe(true); // really connected...
    expect(vinted.hasPublishTool).toBe(false); // ...but there is still no real publish tool for it

    const ebay = result.marketplaces.find((m: any) => m.name === 'ebay');
    const etsy = result.marketplaces.find((m: any) => m.name === 'etsy');
    expect(ebay.hasPublishTool).toBe(true);
    expect(etsy.hasPublishTool).toBe(true);
  });

  it('never leaks MarketplaceConnection credential columns (apiKey/apiSecret/tokens/accountEmail)', async () => {
    marketplaceFindManyMock.mockResolvedValue([{ name: 'ebay', displayName: 'eBay', isAvailable: true }]);
    connectionFindManyMock.mockResolvedValue([{ marketplaceId: 'ebay', status: 'connected' }]);

    // The handler only ever selects marketplaceId/status from the DB —
    // proven structurally: the select passed to findMany names exactly
    // those two fields, so a credential column could never even be read.
    await getMarketplaceConnectionsTool.handler('ws-1', {}, { conversationId: 'conv-1', userId: 'user-1' });

    const [args] = connectionFindManyMock.mock.calls[0];
    expect(args.select).toEqual({ marketplaceId: true, status: true });

    const result: any = await getMarketplaceConnectionsTool.handler('ws-1', {}, { conversationId: 'conv-1', userId: 'user-1' });
    expect(JSON.stringify(result)).not.toMatch(/apiKey|apiSecret|encryptedOauthToken|encryptedRefreshToken|accountEmail/i);
  });

  it('is workspace-scoped — the connection lookup is always filtered by the caller\'s own workspaceId', async () => {
    marketplaceFindManyMock.mockResolvedValue([]);
    connectionFindManyMock.mockResolvedValue([]);

    await getMarketplaceConnectionsTool.handler('ws-ATTACKER', {}, { conversationId: 'conv-1', userId: 'user-1' });

    expect(connectionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'ws-ATTACKER' } }));
  });
});
