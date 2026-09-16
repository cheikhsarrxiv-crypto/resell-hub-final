import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/security';

// This route reads the authenticated session, so it must never be
// statically rendered or cached.
export const dynamic = 'force-dynamic';

/**
 * GET /api/etsy/taxonomy
 * Lists the cached Etsy seller-taxonomy tree (see EtsyTaxonomyNode in
 * schema.prisma) for the product form's "Etsy category" selector.
 *
 * Not workspace-scoped: this is a shared, read-only reference table (Etsy's
 * public category tree), not per-workspace data — any authenticated user
 * can read it. It is populated by scripts/fetch-etsy-taxonomy.ts, run
 * separately with real Etsy API credentials; this route only reads
 * whatever is currently cached, which may be empty until that script has
 * been run once.
 */
export async function GET() {
  try {
    await requireAuth();

    const nodes = await prisma.etsyTaxonomyNode.findMany({
      orderBy: { fullPath: 'asc' },
    });

    return NextResponse.json({ success: true, nodes });
  } catch (error) {
    return errorResponse(error);
  }
}
