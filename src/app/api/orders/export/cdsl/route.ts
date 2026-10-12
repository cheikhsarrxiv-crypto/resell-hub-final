import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVerifiedWorkspaceId, verifyWorkspaceAccess, errorResponse } from '@/lib/security';
import { cdslExportRequestSchema } from '@/lib/validations';
import {
  validateOrderForCdslExport,
  ordersToCdslCsv,
  CdslExportValidationError,
  type OrderForCdslExport,
} from '@/services/fulfillment/CdslExportService';

// Reads the authenticated session — never statically rendered/cached.
export const dynamic = 'force-dynamic';

const CDSL_CANDIDATE_INCLUDE = { items: { include: { product: true } } } as const;

/**
 * GET — lists orders eligible for a CDSL export, each annotated with its
 * own validation result, so the review UI can show errors before the user
 * ever selects/downloads anything (point 4 of the request: "L'utilisateur
 * doit pouvoir vérifier les commandes incluses avant de télécharger le
 * fichier.").
 *
 * Candidate filter — reuses the EXISTING Order.status and
 * Order.fulfillmentOrder relation rather than inventing a new "exported"
 * flag (no migration in this phase; see CdslExportService.ts's own
 * header comment and this feature's final report for why):
 * - excludes 'cancelled' and 'delivered' (already a dead end / already
 *   physically done);
 * - excludes any order that already has a FulfillmentOrder row (it is
 *   already being handled by the existing automatic-fulfillment pipeline
 *   — see FulfillmentService.ts — so listing it here too would invite a
 *   double dispatch).
 * This is a heuristic, not a true export log: it does not know whether a
 * CDSL CSV was already downloaded for an order. See report.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const orders = await prisma.order.findMany({
      where: {
        workspaceId,
        status: { notIn: ['cancelled', 'delivered'] },
        fulfillmentOrder: null,
      },
      include: CDSL_CANDIDATE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const annotated = orders.map((order: OrderForCdslExport) => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      shippingAddress: order.shippingAddress,
      shippingAddress2: order.shippingAddress2,
      shippingCity: order.shippingCity,
      shippingPostalCode: order.shippingPostalCode,
      shippingCountry: order.shippingCountry,
      shippingPhone: order.shippingPhone,
      items: order.items.map((item) => ({
        productId: item.productId,
        sku: item.product?.sku ?? null,
        title: item.title,
        quantity: item.quantity,
      })),
      cdslValidationErrors: validateOrderForCdslExport(order),
    }));

    return NextResponse.json({ success: true, orders: annotated });
  } catch (error) {
    console.error('GET /api/orders/export/cdsl error:', error);
    return errorResponse(error);
  }
}

/**
 * POST — re-validates the given orderIds server-side (never trusts the
 * client's earlier GET snapshot — an order could have changed since) and
 * returns the generated CSV as a file download. Never partially exports:
 * CdslExportValidationError (thrown by ordersToCdslCsv when ANY selected
 * order has ANY error) is returned as 400 with the full, specific error
 * list, and no file body — point 3 of the request: "Ne jamais exporter
 * silencieusement une commande invalide."
 *
 * This route performs NO side effect beyond reading: it does not create a
 * FulfillmentOrder, does not change Order.status, does not call any CDSL
 * API, and does not send any email — see CdslExportService.ts's own
 * header comment for why.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = cdslExportRequestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const { orderIds, desiredDeliveryDate } = result.data;

    if (typeof body.workspaceId !== 'string' || !body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }
    const workspaceId = await verifyWorkspaceAccess(body.workspaceId);

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, workspaceId },
      include: CDSL_CANDIDATE_INCLUDE,
    });

    const foundIds = new Set(orders.map((o) => o.id));
    const missingIds = orderIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return NextResponse.json(
        {
          error: 'Certaines commandes sont introuvables ou n\'appartiennent pas à cet espace de travail',
          details: missingIds,
        },
        { status: 404 }
      );
    }

    let parsedDeliveryDate: Date | null = null;
    if (desiredDeliveryDate) {
      const candidate = new Date(desiredDeliveryDate);
      if (isNaN(candidate.getTime())) {
        return NextResponse.json(
          { error: 'Date de livraison souhaitée invalide', details: [desiredDeliveryDate] },
          { status: 400 }
        );
      }
      parsedDeliveryDate = candidate;
    }

    let csv: string;
    try {
      csv = ordersToCdslCsv(orders, { desiredDeliveryDate: parsedDeliveryDate });
    } catch (error) {
      if (error instanceof CdslExportValidationError) {
        return NextResponse.json(
          {
            error: 'Validation échouée — aucun fichier généré',
            details: error.results.flatMap((r) => r.errors),
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `cdsl-export-${timestamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('POST /api/orders/export/cdsl error:', error);
    return errorResponse(error);
  }
}
