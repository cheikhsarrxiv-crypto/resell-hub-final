/**
 * One-off script: populates EtsyTaxonomyNode from Etsy's real public
 * seller-taxonomy tree (GET /v3/application/seller-taxonomy/nodes).
 *
 * NOT run automatically anywhere (not in postinstall, not in a cron) —
 * Etsy's taxonomy changes rarely, so this is meant to be run manually,
 * once, and re-run only when Etsy's categories actually change.
 *
 * Cannot be run from this sandbox: no ETSY_CLIENT_ID configured here and
 * developer.etsy.com/api.etsy.com are network-egress-blocked in this
 * environment. Run this from an environment with real Etsy API
 * credentials and normal internet access:
 *
 *   ETSY_CLIENT_ID=... npx tsx scripts/fetch-etsy-taxonomy.ts
 *
 * Auth: verified against Etsy's published OpenAPI v3 spec — this
 * endpoint's only requirement is the `x-api-key` header (the app's
 * keystring/client ID), no OAuth access token needed (it's public
 * reference data, not seller-scoped).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface EtsySellerTaxonomyNode {
  id: number;
  level: number;
  name: string;
  parent_id: number | null;
  children?: EtsySellerTaxonomyNode[];
}

function flatten(nodes: EtsySellerTaxonomyNode[], pathPrefix: string[] = []): { id: number; name: string; level: number; parentId: number | null; fullPath: string }[] {
  const rows: { id: number; name: string; level: number; parentId: number | null; fullPath: string }[] = [];
  for (const node of nodes) {
    const fullPath = [...pathPrefix, node.name].join(' > ');
    rows.push({ id: node.id, name: node.name, level: node.level, parentId: node.parent_id, fullPath });
    if (node.children?.length) {
      rows.push(...flatten(node.children, [...pathPrefix, node.name]));
    }
  }
  return rows;
}

async function main() {
  const clientId = process.env.ETSY_CLIENT_ID;
  if (!clientId) {
    throw new Error('ETSY_CLIENT_ID must be set to fetch Etsy taxonomy data.');
  }

  const response = await fetch('https://api.etsy.com/v3/application/seller-taxonomy/nodes', {
    headers: { 'x-api-key': clientId },
  });

  if (!response.ok) {
    throw new Error(`Etsy seller-taxonomy request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rows = flatten(data.results || []);

  console.log(`Fetched ${rows.length} Etsy taxonomy nodes. Upserting...`);

  for (const row of rows) {
    await prisma.etsyTaxonomyNode.upsert({
      where: { id: row.id },
      update: row,
      create: row,
    });
  }

  console.log('Done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
