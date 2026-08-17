import { CreateListingInput, UpdateListingInput } from '@/lib/validations';
import { prisma } from '@/lib/prisma';
import { AdapterFactory } from './marketplace/AdapterFactory';
import { Marketplace } from '@/types/marketplace';
import MarketplaceAdapter from './marketplace/MarketplaceAdapter';

/**
 * Get a configured marketplace adapter for a given marketplace name.
 * Reads OAuth credentials from environment variables per marketplace.
 */
function getAdapterForMarketplace(marketplaceName: string): MarketplaceAdapter {
  const normalized = marketplaceName.toUpperCase() as Marketplace;

  const configByMarketplace: Record<string, { clientId: string; clientSecret: string; redirectUri: string; sandboxMode: boolean }> = {
    EBAY: {
      clientId: process.env.EBAY_CLIENT_ID || '',
      clientSecret: process.env.EBAY_CLIENT_SECRET || '',
      redirectUri: process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay',
      sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
    },
    ETSY: {
      clientId: process.env.ETSY_CLIENT_ID || '',
      clientSecret: process.env.ETSY_CLIENT_SECRET || '',
      redirectUri: process.env.ETSY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/etsy',
      sandboxMode: process.env.ETSY_SANDBOX_MODE !== 'false',
    },
    DEPOP: {
      clientId: process.env.DEPOP_CLIENT_ID || '',
      clientSecret: process.env.DEPOP_CLIENT_SECRET || '',
      redirectUri: process.env.DEPOP_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/depop',
      sandboxMode: process.env.DEPOP_SANDBOX_MODE !== 'false',
    },
    VINTED: {
      clientId: process.env.VINTED_CLIENT_ID || '',
      clientSecret: process.env.VINTED_CLIENT_SECRET || '',
      redirectUri: process.env.VINTED_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/vinted',
      sandboxMode: process.env.VINTED_SANDBOX_MODE !== 'false',
    },
  };

  const config = configByMarketplace[normalized];

  if (!config) {
    throw new Error(`Unsupported marketplace: ${marketplaceName}`);
  }

  return AdapterFactory.createAdapter(normalized, config);
}

export class ListingService {
  /**
   * Create listing and publish to selected marketplaces
   */
  static async createListing(workspaceId: string, data: CreateListingInput) {
    try {
      // Get product
      const product = await prisma.product.findFirst({
        where: {
          id: data.productId,
          workspaceId,
        },
        include: { images: { orderBy: { order: 'asc' } } },
      });

      if (!product) {
        throw new Error('Product not found');
      }

      // Check listing limits
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { subscription: { include: { plan: true } } },
      });

      if (workspace?.subscription?.plan) {
        const listingCount = await prisma.listing.count({
          where: { workspaceId },
        });

        if (listingCount >= workspace.subscription.plan.maxListings) {
          throw new Error('Listing limit reached for your plan');
        }
      }

      // Create listings for each marketplace
      const createdListings = [];

      for (const marketplaceId of data.marketplaceIds) {
        const connection = await prisma.marketplaceConnection.findFirst({
          where: {
            workspaceId,
            marketplaceId,
          },
          include: { marketplace: true },
        });

        if (!connection) {
          throw new Error(`Marketplace not connected: ${marketplaceId}`);
        }

        // Get adapter
        const adapter = getAdapterForMarketplace(connection.marketplace.name);

        try {
          // Publish to marketplace
          const listingResponse = await adapter.createListing({
            title: data.title,
            description: data.description,
            price: data.price,
            quantity: data.quantity,
            sku: product.sku,
            images: product.images.map((img: any) => img.url),
            category: product.category || undefined,
          });

          // Create listing in database
          const listing = await prisma.listing.create({
            data: {
              productId: product.id,
              workspaceId,
              marketplaceConnectionId: connection.id,
              externalId: listingResponse.externalId,
              title: data.title,
              description: data.description,
              price: data.price,
              quantity: data.quantity,
              status: 'active',
              syncStatus: 'synced',
            },
            include: {
              connection: {
                include: { marketplace: true },
              },
            },
          });

          createdListings.push(listing);
        } catch (error) {
          console.error(`Failed to create listing on ${connection.marketplace.displayName}:`, error);

          // Map to a short, user-facing message. Never store the raw
          // exception message or a stack trace — only known, safe phrasing.
          const rawMessage = error instanceof Error ? error.message : '';
          let syncError = `Couldn't publish to ${connection.marketplace.displayName}. Please try again.`;
          if (/not connected/i.test(rawMessage)) {
            syncError = `${connection.marketplace.displayName} isn't connected. Reconnect it in Settings and try again.`;
          } else if (/unauthorized|token|expired/i.test(rawMessage)) {
            syncError = `Your ${connection.marketplace.displayName} connection has expired. Reconnect it in Settings and try again.`;
          } else if (/limit|quota/i.test(rawMessage)) {
            syncError = `${connection.marketplace.displayName} rejected this listing due to an account limit.`;
          }

          // Create listing with error status
          const listing = await prisma.listing.create({
            data: {
              productId: product.id,
              workspaceId,
              marketplaceConnectionId: connection.id,
              title: data.title,
              description: data.description,
              price: data.price,
              quantity: data.quantity,
              status: 'active',
              syncStatus: 'failed',
              syncError,
            },
          });

          createdListings.push(listing);
        }
      }

      return createdListings;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get listing details
   */
  static async getListing(listingId: string, workspaceId: string) {
    return prisma.listing.findFirst({
      where: {
        id: listingId,
        workspaceId,
      },
      include: {
        product: {
          include: { images: true },
        },
        connection: {
          include: { marketplace: true },
        },
        orders: true,
      },
    });
  }

  /**
   * Get all listings for workspace
   */
  static async getListings(
    workspaceId: string,
    limit = 50,
    offset = 0,
    status?: string,
    marketplaceId?: string
  ) {
    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(status ? { status } : {}),
          ...(marketplaceId ? { connection: { marketplaceId } } : {}),
        },
        include: {
          product: true,
          connection: { include: { marketplace: true } },
          orders: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.listing.count({
        where: {
          workspaceId,
          deletedAt: null,
          ...(status ? { status } : {}),
        },
      }),
    ]);

    return { listings, total };
  }

  /**
   * Update listing
   */
  static async updateListing(
    listingId: string,
    workspaceId: string,
    data: UpdateListingInput
  ) {
    const listing = await prisma.listing.findFirst({
      where: { id: listingId, workspaceId },
      include: { connection: { include: { marketplace: true } } },
    });

    if (!listing) {
      throw new Error('Listing not found');
    }

    // Update on marketplace
    if (listing.connection && listing.externalId) {
      const adapter = getAdapterForMarketplace(listing.connection.marketplace.name);

      try {
        await adapter.updateListing(listing.externalId, {
          title: data.title,
          description: data.description,
          price: data.price,
          quantity: data.quantity,
        });
      } catch (error) {
        console.error('Failed to update listing on marketplace:', error);
      }
    }

    // Update in database
    return prisma.listing.update({
      where: { id: listingId },
      data: {
        title: data.title || listing.title,
        description: data.description || listing.description,
        price: data.price || listing.price,
        quantity: data.quantity || listing.quantity,
      },
      include: {
        connection: { include: { marketplace: true } },
      },
    });
  }

  /**
   * Delist/delete listing
   */
  static async deleteListing(listingId: string, workspaceId: string) {
    const listing = await prisma.listing.findFirst({
      where: { id: listingId, workspaceId },
      include: { connection: { include: { marketplace: true } } },
    });

    if (!listing) {
      throw new Error('Listing not found');
    }

    // Delete from marketplace
    if (listing.connection && listing.externalId) {
      const adapter = getAdapterForMarketplace(listing.connection.marketplace.name);

      try {
        await adapter.deleteListing(listing.externalId);
      } catch (error) {
        console.error('Failed to delete listing from marketplace:', error);
      }
    }

    // Mark as deleted in database
    return prisma.listing.update({
      where: { id: listingId },
      data: {
        deletedAt: new Date(),
        status: 'delisted',
      },
    });
  }

  /**
   * Sync inventory across all listings
   */
  static async syncListingInventory(productId: string, workspaceId: string, quantity: number) {
    const listings = await prisma.listing.findMany({
      where: {
        productId,
        workspaceId,
        status: 'active',
        deletedAt: null,
      },
      include: {
        connection: { include: { marketplace: true } },
      },
    });

    const updates = [];

    for (const listing of listings) {
      if (listing.connection && listing.externalId) {
        const adapter = getAdapterForMarketplace(listing.connection.marketplace.name);

        try {
          await adapter.updateInventory(listing.externalId, quantity);
          updates.push({
            listingId: listing.id,
            status: 'synced',
          });
        } catch (error) {
          console.error(`Failed to sync inventory for listing ${listing.id}:`, error);
          updates.push({
            listingId: listing.id,
            status: 'failed',
          });
        }
      }
    }

    // Update all listings
    for (const update of updates) {
      await prisma.listing.update({
        where: { id: update.listingId },
        data: {
          quantity,
          syncStatus: update.status as any,
        },
      });
    }

    return updates;
  }

  /**
   * Handle sold out - delist from all marketplaces when inventory reaches 0
   */
  static async handleSoldOut(productId: string, workspaceId: string) {
    const listings = await prisma.listing.findMany({
      where: {
        productId,
        workspaceId,
        status: 'active',
        deletedAt: null,
      },
      include: {
        connection: { include: { marketplace: true } },
      },
    });

    for (const listing of listings) {
      // Update to sold out status
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          status: 'sold_out',
          quantity: 0,
        },
      });

      // Try to delist from marketplace
      if (listing.connection && listing.externalId) {
        const adapter = getAdapterForMarketplace(listing.connection.marketplace.name);

        try {
          await adapter.updateInventory(listing.externalId, 0);
        } catch (error) {
          console.error(`Failed to update marketplace inventory:`, error);
        }
      }
    }

    return listings;
  }

  /**
   * Get listing statistics
   */
  static async getListingStats(workspaceId: string) {
    const [
      activeListings,
      delistedListings,
      soldOutListings,
      totalOrders,
    ] = await Promise.all([
      prisma.listing.count({
        where: { workspaceId, status: 'active', deletedAt: null },
      }),
      prisma.listing.count({
        where: { workspaceId, status: 'delisted', deletedAt: null },
      }),
      prisma.listing.count({
        where: { workspaceId, status: 'sold_out', deletedAt: null },
      }),
      prisma.order.count({
        where: { workspaceId },
      }),
    ]);

    return {
      activeListings,
      delistedListings,
      soldOutListings,
      totalOrders,
    };
  }
}
