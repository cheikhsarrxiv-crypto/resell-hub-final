/**
 * Proves the webhook idempotency fix: the same Stripe event.id must never
 * be processed twice, including when two deliveries race concurrently.
 * Dedup is enforced by WebhookLog's existing
 * @@unique([workspaceId, marketplace, eventId]) constraint (real
 * PostgreSQL unique-constraint violation, not an application-level
 * check-then-act) — this test exercises the actual route handler and a
 * real database, so it proves the DB-level guarantee is really wired up,
 * not just that the intended logic reads correctly.
 *
 * Only StripeService (signature verification + the 4 event handlers) is
 * mocked — no real Stripe account/keys are available here, and the
 * handlers themselves are already covered by their own tests
 * (stripe-checkout-metadata.test.ts, stripe-payment-failed-metadata.test.ts).
 * Everything touching WebhookLog/Workspace/User runs against a real
 * PostgreSQL database.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const {
  mockVerifyWebhookSignature,
  mockHandleSubscriptionCreated,
  mockHandleSubscriptionUpdated,
  mockHandleSubscriptionDeleted,
  mockHandlePaymentFailed,
} = vi.hoisted(() => ({
  mockVerifyWebhookSignature: vi.fn(),
  mockHandleSubscriptionCreated: vi.fn().mockResolvedValue(undefined),
  mockHandleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
  mockHandleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
  mockHandlePaymentFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/StripeService', () => ({
  StripeService: {
    verifyWebhookSignature: mockVerifyWebhookSignature,
    handleSubscriptionCreated: mockHandleSubscriptionCreated,
    handleSubscriptionUpdated: mockHandleSubscriptionUpdated,
    handleSubscriptionDeleted: mockHandleSubscriptionDeleted,
    handlePaymentFailed: mockHandlePaymentFailed,
  },
}));

import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { POST } from '@/app/api/stripe/webhooks/route';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

function buildRequest(eventId: string) {
  return new NextRequest('http://localhost/api/stripe/webhooks', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: JSON.stringify({ id: eventId }),
  });
}

async function createWorkspace(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `webhook-idem-${suffix}@example.com`, name: 'Webhook Idem Test', password: 'not-used' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Webhook Idem Workspace', slug: `webhook-idem-${suffix}`, userId: user.id },
  });
  return { user, workspace };
}

async function cleanup(user: any, workspace: any) {
  await prisma.webhookLog.deleteMany({ where: { workspaceId: workspace.id } });
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('Stripe webhook — idempotence by event.id', () => {
  beforeEach(() => {
    mockHandleSubscriptionCreated.mockClear();
  });

  it('processes a new event exactly once and records it as processed', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { user, workspace } = await createWorkspace(suffix);
    const eventId = `evt_test_${suffix}`;
    const event = {
      id: eventId,
      type: 'customer.subscription.created',
      data: { object: { metadata: { workspaceId: workspace.id } } },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    try {
      const res1 = await POST(buildRequest(eventId));
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.duplicate).toBeUndefined();
      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(1);

      const logRow = await prisma.webhookLog.findUnique({
        where: {
          workspaceId_marketplace_eventId: {
            workspaceId: workspace.id,
            marketplace: 'stripe',
            eventId,
          },
        },
      });
      expect(logRow?.status).toBe('processed');
      expect(logRow?.eventType).toBe('customer.subscription.created');

      // Same event delivered again (Stripe redelivery) — must be a no-op.
      const res2 = await POST(buildRequest(eventId));
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.duplicate).toBe(true);
      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(1); // still just once
    } finally {
      await cleanup(user, workspace);
    }
  });

  it('does not double-process two concurrent deliveries of the same event', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { user, workspace } = await createWorkspace(suffix);
    const eventId = `evt_concurrent_${suffix}`;
    const event = {
      id: eventId,
      type: 'customer.subscription.created',
      data: { object: { metadata: { workspaceId: workspace.id } } },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    try {
      // Fire both "deliveries" at once — races on the same
      // (workspaceId, "stripe", eventId) unique constraint.
      const [res1, res2] = await Promise.all([
        POST(buildRequest(eventId)),
        POST(buildRequest(eventId)),
      ]);

      expect([res1.status, res2.status]).toEqual([200, 200]);
      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);
      const duplicateFlags = [json1.duplicate, json2.duplicate].sort();
      // Exactly one of the two treated it as new, the other as a duplicate.
      expect(duplicateFlags).toEqual([true, undefined]);

      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup(user, workspace);
    }
  });

  it('reprocesses an event whose prior WebhookLog row is stale (stuck at "processing")', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { user, workspace } = await createWorkspace(suffix);
    const eventId = `evt_stale_${suffix}`;
    const event = {
      id: eventId,
      type: 'customer.subscription.created',
      data: { object: { metadata: { workspaceId: workspace.id } } },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    try {
      // Simulate a previous delivery that crashed mid-processing (killed
      // before it could reach the route's own error handling): a
      // WebhookLog row stuck at "processing", created well past a
      // realistic request duration.
      await prisma.webhookLog.create({
        data: {
          workspaceId: workspace.id,
          marketplace: 'stripe',
          eventId,
          eventType: event.type,
          payload: event.type,
          status: 'processing',
          createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        },
      });

      const res = await POST(buildRequest(eventId));
      const json = await res.json();
      expect(json.duplicate).toBeUndefined();
      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(1);

      const logRow = await prisma.webhookLog.findUnique({
        where: {
          workspaceId_marketplace_eventId: {
            workspaceId: workspace.id,
            marketplace: 'stripe',
            eventId,
          },
        },
      });
      expect(logRow?.status).toBe('processed');
    } finally {
      await cleanup(user, workspace);
    }
  });

  it('reprocesses an event after a transient failure (500) once Stripe redelivers it — never silently swallowed', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { user, workspace } = await createWorkspace(suffix);
    const eventId = `evt_retry_after_failure_${suffix}`;
    const event = {
      id: eventId,
      type: 'customer.subscription.created',
      data: { object: { metadata: { workspaceId: workspace.id } } },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    // First attempt: the handler throws (simulating a transient DB blip).
    mockHandleSubscriptionCreated.mockRejectedValueOnce(new Error('transient failure'));

    try {
      const res1 = await POST(buildRequest(eventId));
      expect(res1.status).toBe(500);
      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(1);

      const logAfterFailure = await prisma.webhookLog.findUnique({
        where: {
          workspaceId_marketplace_eventId: { workspaceId: workspace.id, marketplace: 'stripe', eventId },
        },
      });
      // Must be "failed", not stuck at "processing" — that's what lets a
      // redelivery be treated as a retry instead of a duplicate.
      expect(logAfterFailure?.status).toBe('failed');
      expect(logAfterFailure?.error).toContain('transient failure');

      // Stripe redelivers the same event.id after receiving the 500. This
      // time the handler succeeds.
      const res2 = await POST(buildRequest(eventId));
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.duplicate).toBeUndefined(); // reprocessed, not swallowed as a duplicate
      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(2); // called again on retry

      const logAfterRetry = await prisma.webhookLog.findUnique({
        where: {
          workspaceId_marketplace_eventId: { workspaceId: workspace.id, marketplace: 'stripe', eventId },
        },
      });
      expect(logAfterRetry?.status).toBe('processed');
    } finally {
      await cleanup(user, workspace);
    }
  });

  it('does not double-process two concurrent retries of the same previously-failed event', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { user, workspace } = await createWorkspace(suffix);
    const eventId = `evt_concurrent_retry_${suffix}`;
    const event = {
      id: eventId,
      type: 'customer.subscription.created',
      data: { object: { metadata: { workspaceId: workspace.id } } },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    // Pre-seed a WebhookLog row already marked "failed" (a prior attempt
    // that ran, threw, and returned its own 500).
    await prisma.webhookLog.create({
      data: {
        workspaceId: workspace.id,
        marketplace: 'stripe',
        eventId,
        eventType: event.type,
        payload: event.type,
        status: 'failed',
        error: 'previous transient failure',
      },
    });

    try {
      const [res1, res2] = await Promise.all([
        POST(buildRequest(eventId)),
        POST(buildRequest(eventId)),
      ]);

      expect([res1.status, res2.status]).toEqual([200, 200]);
      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);
      const duplicateFlags = [json1.duplicate, json2.duplicate].sort();
      expect(duplicateFlags).toEqual([true, undefined]);

      expect(mockHandleSubscriptionCreated).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup(user, workspace);
    }
  });
});
