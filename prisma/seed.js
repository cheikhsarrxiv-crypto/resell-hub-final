const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_PRODUCTS = [
  {
    sku: 'NIKE-AM95-001',
    title: 'Nike Air Max 95 OG Neon',
    description: 'Classic Nike Air Max 95 in excellent condition. Original box included. Size 42 EU.',
    brand: 'Nike',
    category: 'Sneakers',
    size: '42',
    color: 'White/Neon Yellow',
    condition: 'like-new',
    purchasePrice: 45,
    sellingPrice: 120,
    fulfillmentCost: 5,
    fees: 15,
    quantity: 2,
    location: 'Shelf A1',
  },
  {
    sku: 'ADIDAS-CAMPUS-002',
    title: 'Adidas Campus 00s Cream White',
    description: 'Adidas Campus in perfect condition. Worn once. Size 43 EU.',
    brand: 'Adidas',
    category: 'Sneakers',
    size: '43',
    color: 'Cream White',
    condition: 'new',
    purchasePrice: 40,
    sellingPrice: 95,
    fulfillmentCost: 5,
    fees: 12,
    quantity: 1,
    location: 'Shelf A2',
  },
  {
    sku: 'LEVIS-501-003',
    title: 'Levi\'s 501 Original Blue Jeans',
    description: 'Authentic Levi\'s 501 jeans. Perfect vintage condition. Size 32x32.',
    brand: 'Levi\'s',
    category: 'Clothing',
    size: '32x32',
    color: 'Dark Blue',
    condition: 'good',
    purchasePrice: 35,
    sellingPrice: 65,
    fulfillmentCost: 4,
    fees: 8,
    quantity: 1,
    location: 'Shelf B1',
  },
  {
    sku: 'CARHARTT-JACKET-004',
    title: 'Carhartt WIP Detroit Jacket Brown',
    description: 'Iconic Carhartt work jacket. Excellent condition. Size L.',
    brand: 'Carhartt',
    category: 'Outerwear',
    size: 'L',
    color: 'Brown',
    condition: 'like-new',
    purchasePrice: 50,
    sellingPrice: 140,
    fulfillmentCost: 6,
    fees: 18,
    quantity: 1,
    location: 'Shelf B2',
  },
  {
    sku: 'NB-2002R-005',
    title: 'New Balance 2002R Protection Pack',
    description: 'Limited edition New Balance 2002R. DS condition. Size 44 EU.',
    brand: 'New Balance',
    category: 'Sneakers',
    size: '44',
    color: 'Grey/Navy',
    condition: 'new',
    purchasePrice: 75,
    sellingPrice: 180,
    fulfillmentCost: 6,
    fees: 25,
    quantity: 1,
    location: 'Shelf C1',
  },
];

const MARKETPLACES = [
  { name: 'vinted', displayName: 'Vinted' },
  { name: 'ebay', displayName: 'eBay' },
  { name: 'depop', displayName: 'Depop' },
  { name: 'etsy', displayName: 'Etsy' },
];

const PLANS = [
  {
    name: 'free',
    displayName: 'Free',
    description: 'For beginners',
    price: 0,
    maxProducts: 10,
    maxListings: 20,
    maxOrders: 50,
    maxMarketplaces: 2,
    maxUsers: 1,
    fulfillmentEnabled: false,
    advancedAnalytics: false,
    apiAccess: false,
    // No Stripe Price ID needed for Free plan
    stripePriceIdMonthly: null,
    stripePriceIdAnnual: null,
  },
  {
    name: 'starter',
    displayName: 'Starter',
    description: 'For small resellers',
    price: 19,
    maxProducts: 100,
    maxListings: 300,
    maxOrders: 500,
    maxMarketplaces: 3,
    maxUsers: 1,
    fulfillmentEnabled: false,
    advancedAnalytics: false,
    apiAccess: false,
    // TODO: Configure in Stripe and add Price ID
    // Format: price_1234567890abcdefghijklmn
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ID_STARTER_MONTHLY || null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ID_STARTER_ANNUAL || null,
  },
  {
    name: 'pro',
    displayName: 'Pro',
    description: 'For serious resellers',
    price: 49,
    maxProducts: 500,
    maxListings: 1500,
    maxOrders: 2000,
    maxMarketplaces: 4,
    maxUsers: 1,
    fulfillmentEnabled: true,
    advancedAnalytics: true,
    apiAccess: false,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ID_PRO_MONTHLY || null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ID_PRO_ANNUAL || null,
  },
  {
    name: 'business',
    displayName: 'Business',
    description: 'For large operations',
    price: 99,
    maxProducts: 5000,
    maxListings: 10000,
    maxOrders: 10000,
    maxMarketplaces: 4,
    maxUsers: 5,
    fulfillmentEnabled: true,
    advancedAnalytics: true,
    apiAccess: true,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ID_BUSINESS_MONTHLY || null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ID_BUSINESS_ANNUAL || null,
  },
  {
    name: 'enterprise',
    displayName: 'Enterprise',
    description: 'Custom solution',
    price: 0,
    maxProducts: 999999,
    maxListings: 999999,
    maxOrders: 999999,
    maxMarketplaces: 4,
    maxUsers: 999,
    fulfillmentEnabled: true,
    advancedAnalytics: true,
    apiAccess: true,
    // No Stripe Price ID for Enterprise (custom pricing)
    stripePriceIdMonthly: null,
    stripePriceIdAnnual: null,
  },
];

async function main() {
  console.log('🌱 Seeding database...');

  // Create marketplaces
  console.log('Creating marketplaces...');
  for (const marketplace of MARKETPLACES) {
    await prisma.marketplace.upsert({
      where: { name: marketplace.name },
      update: {},
      create: marketplace,
    });
  }

  // Create plans
  console.log('Creating subscription plans...');
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: {},
      create: plan,
    });
  }

  // Create fulfillment partner
  console.log('Creating fulfillment partner...');
  await prisma.fulfillmentPartner.upsert({
    where: { name: 'ShipMock France' },
    update: {},
    create: {
      name: 'ShipMock France',
      country: 'FR',
      apiUrl: 'https://api.shipmock.local/v1',
      processingTime: 24,
      deliveryTime: 48,
      costPerOrder: 5,
      costPerKg: 2,
    },
  });

  // Create demo user
  console.log('Creating demo user...');
  const hashedPassword = await bcrypt.hash('demo1234', 10);
  const user = await prisma.user.upsert({
    where: { email: 'demo@reselling.local' },
    update: {},
    create: {
      email: 'demo@reselling.local',
      password: hashedPassword,
      name: 'Demo Seller',
      country: 'FR',
    },
  });

  // Create Pro subscription
  console.log('Creating Pro subscription...');
  const proPlan = await prisma.plan.findUnique({
    where: { name: 'pro' },
  });

  const subscription = await prisma.subscription.create({
    data: {
      planId: proPlan.id,
      status: 'active',
      startDate: new Date(),
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // Create workspace
  console.log('Creating workspace...');
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Demo Shop',
      slug: 'demo-shop',
      description: 'Demo reselling shop for testing',
      country: 'FR',
      userId: user.id,
      subscriptionId: subscription.id,
    },
  });

  // Create marketplace connections
  console.log('Creating marketplace connections...');
  const vinted = await prisma.marketplace.findUnique({ where: { name: 'vinted' } });
  const ebay = await prisma.marketplace.findUnique({ where: { name: 'ebay' } });
  const depop = await prisma.marketplace.findUnique({ where: { name: 'depop' } });

  await prisma.marketplaceConnection.createMany({
    data: [
      {
        workspaceId: workspace.id,
        marketplaceId: vinted.id,
        status: 'mock',
        accountName: 'demo_vinted_account',
      },
      {
        workspaceId: workspace.id,
        marketplaceId: ebay.id,
        status: 'mock',
        accountName: 'demo_ebay_seller',
      },
      {
        workspaceId: workspace.id,
        marketplaceId: depop.id,
        status: 'mock',
        accountName: 'demo_depop_shop',
      },
    ],
  });

  // Create products
  console.log('Creating demo products...');
  for (const productData of DEMO_PRODUCTS) {
    const product = await prisma.product.create({
      data: {
        ...productData,
        workspaceId: workspace.id,
      },
    });

    // Create inventory record
    await prisma.inventory.create({
      data: {
        productId: product.id,
        workspaceId: workspace.id,
        quantity: productData.quantity,
        available: productData.quantity,
        reserved: 0,
        syncStatus: 'synced',
      },
    });
  }

  // Create some listings
  console.log('Creating listings...');
  const products = await prisma.product.findMany({
    where: { workspaceId: workspace.id },
  });

  const vintedConnection = await prisma.marketplaceConnection.findFirst({
    where: { workspaceId: workspace.id, marketplace: { name: 'vinted' } },
  });

  const ebayConnection = await prisma.marketplaceConnection.findFirst({
    where: { workspaceId: workspace.id, marketplace: { name: 'ebay' } },
  });

  for (const product of products.slice(0, 3)) {
    // Vinted listing
    await prisma.listing.create({
      data: {
        productId: product.id,
        workspaceId: workspace.id,
        marketplaceConnectionId: vintedConnection.id,
        externalId: `VINTED-${product.sku}`,
        title: product.title,
        description: product.description,
        price: product.sellingPrice,
        quantity: product.quantity,
        status: 'active',
        syncStatus: 'synced',
      },
    });

    // eBay listing
    await prisma.listing.create({
      data: {
        productId: product.id,
        workspaceId: workspace.id,
        marketplaceConnectionId: ebayConnection.id,
        externalId: `EBAY-${product.sku}`,
        title: product.title,
        description: product.description,
        price: product.sellingPrice,
        quantity: product.quantity,
        status: 'active',
        syncStatus: 'synced',
      },
    });
  }

  // Create sample orders with different statuses
  console.log('Creating sample orders...');
  const listings = await prisma.listing.findMany({
    where: { workspaceId: workspace.id },
  });

  // Order 1: Pending
  if (listings.length > 0) {
    const order1 = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        listingId: listings[0].id,
        externalOrderId: 'EXT-ORD-001',
        customerId: 'CUST-001',
        customerName: 'Alice Martin',
        customerEmail: 'alice@example.com',
        totalPrice: 120,
        marketplaceFees: 15,
        estimatedProfit: 85,
        status: 'pending',
        fulfillmentType: 'self',
        shippingAddress: '123 Rue de Paris',
        shippingCity: 'Paris',
        shippingPostalCode: '75001',
        shippingCountry: 'FR',
        items: {
          create: [
            {
              productId: listings[0].productId,
              title: listings[0].product.title,
              quantity: 1,
              price: listings[0].price,
            },
          ],
        },
      },
    });

    // Order 2: Processing with Fulfillment
    if (listings.length > 1) {
      const fulfillmentPartner = await prisma.fulfillmentPartner.findFirst({
        where: { name: 'ShipMock France' },
      });

      const order2 = await prisma.order.create({
        data: {
          workspaceId: workspace.id,
          listingId: listings[1].id,
          externalOrderId: 'EXT-ORD-002',
          customerId: 'CUST-002',
          customerName: 'Bob Dupont',
          customerEmail: 'bob@example.com',
          totalPrice: 95,
          marketplaceFees: 12,
          estimatedProfit: 65,
          status: 'processing',
          fulfillmentType: 'automatic',
          shippingAddress: '456 Avenue Montaigne',
          shippingCity: 'Lyon',
          shippingPostalCode: '69000',
          shippingCountry: 'FR',
          items: {
            create: [
              {
                productId: listings[1].productId,
                title: listings[1].product.title,
                quantity: 1,
                price: listings[1].price,
              },
            ],
          },
        },
      });

      // Create fulfillment order
      await prisma.fulfillmentOrder.create({
        data: {
          workspaceId: workspace.id,
          orderId: order2.id,
          partnerId: fulfillmentPartner.id,
          status: 'processing',
          quantity: 1,
          totalCost: 5,
          revenue: 95,
          profit: 73,
        },
      });
    }

    // Order 3: Shipped with tracking
    if (listings.length > 2) {
      const fulfillmentPartner = await prisma.fulfillmentPartner.findFirst({
        where: { name: 'ShipMock France' },
      });

      const order3 = await prisma.order.create({
        data: {
          workspaceId: workspace.id,
          listingId: listings[2].id,
          externalOrderId: 'EXT-ORD-003',
          customerId: 'CUST-003',
          customerName: 'Caroline Petit',
          customerEmail: 'caroline@example.com',
          totalPrice: 140,
          marketplaceFees: 18,
          estimatedProfit: 101,
          status: 'shipped',
          fulfillmentType: 'automatic',
          shippingAddress: '789 Boulevard Saint-Germain',
          shippingCity: 'Paris',
          shippingPostalCode: '75005',
          shippingCountry: 'FR',
          items: {
            create: [
              {
                productId: listings[2].productId,
                title: listings[2].product.title,
                quantity: 1,
                price: listings[2].price,
              },
            ],
          },
        },
      });

      // Create fulfillment order with shipment
      const fulfillmentOrder = await prisma.fulfillmentOrder.create({
        data: {
          workspaceId: workspace.id,
          orderId: order3.id,
          partnerId: fulfillmentPartner.id,
          status: 'shipped',
          quantity: 1,
          totalCost: 6,
          revenue: 140,
          profit: 116,
        },
      });

      // Create shipment
      await prisma.shipment.create({
        data: {
          fulfillmentOrderId: fulfillmentOrder.id,
          partnerId: fulfillmentPartner.id,
          trackingNumber: 'FR123456789123',
          carrier: 'La Poste',
          trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=FR123456789123',
          status: 'in_transit',
          estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          trackingEvents: {
            create: [
              {
                status: 'picked_up',
                location: 'Fulfillment Center Paris',
                description: 'Package picked up from fulfillment center',
                timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
              },
              {
                status: 'in_transit',
                location: 'Distribution Center Lyon',
                description: 'Package in transit to delivery area',
                timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
              },
            ],
          },
        },
      });
    }
  }

  console.log('✅ Seeding complete!');
  console.log('');
  console.log('Demo credentials:');
  console.log('Email: demo@reselling.local');
  console.log('Password: demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
