/**
 * Fulfillment Integration Foundation V1 — webhook foundation tests.
 * processFulfillmentWebhookEvent reuses the EXISTING WebhookLog model
 * (same @@unique([workspaceId, marketplace, eventId]) idempotency
 * mechanism already proven by /api/stripe/webhooks/route.ts, just with
 * marketplace holding a fulfillment provider id instead of "stripe") — no
 * schema change, so these tests mock prisma exactly the way
 * FulfillmentService.test.ts already does: in-memory stores standing in
 * for real Postgres rows and constraints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';

const { fulfillmentOrderStore, webhookLogStore } = vi.hoisted(() => ({
  fulfillmentOrderStore: new Map<string, any>(), // key: externalOrderId
  webhookLogStore: new Map<string, any>(), // key: `${workspaceId}::${marketplace}::${eventId}`
}));

let webhookLogIdCounter = 0;

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fulfillmentOrder: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const row of fulfillmentOrderStore.values()) {
          if (row.externalOrderId === where.externalOrderId) return { ...row };
        }
        return null;
      }),
    },
    webhookLog: {
      create: vi.fn(async ({ data }: any) => {
        const key = `${data.workspaceId}::${data.marketplace}::${data.eventId}`;
        if (webhookLogStore.has(key)) throw p2002(['workspaceId', 'marketplace', 'eventId']);
        const row = { id: `log-${++webhookLogIdCounter}`, createdAt: new Date(), processedAt: null, error: null, ...data };
        webhookLogStore.set(key, row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const { workspaceId, marketplace, eventId } = where.workspaceId_marketplace_eventId;
        const row = webhookLogStore.get(`${workspaceId}::${marketplace}::${eventId}`);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = [...webhookLogStore.values()].find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        if (where.processedAt === null && row.processedAt !== null) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = [...webhookLogStore.values()].find((r) => r.id === where.id);
        if (!row) throw new Error('log not found');
        Object.assign(row, data);
        return { ...row };
      }),
    },
  },
}));

import { processFulfillmentWebhookEvent } from '@/services/fulfillment/webhooks/WebhookEventProcessor';
import type { FulfillmentWebhookEnvelope } from '@/services/fulfillment/webhooks/types';

function sign(body: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeEnvelope(overrides: Partial<FulfillmentWebhookEnvelope> & { payload?: object } = {}): FulfillmentWebhookEnvelope {
  const payload = overrides.payload ?? { externalOrderId: 'MOCK-order-1', event: 'shipped' };
  const rawBody = overrides.rawBody ?? JSON.stringify(payload);
  return {
    providerId: 'mock',
    eventId: 'evt-1',
    eventType: 'order.shipped',
    timestamp: new Date(),
    signatureHeader: null,
    ...overrides,
    rawBody,
  };
}

describe('processFulfillmentWebhookEvent', () => {
  beforeEach(() => {
    fulfillmentOrderStore.clear();
    webhookLogStore.clear();
    vi.clearAllMocks();
    fulfillmentOrderStore.set('fo-1', { id: 'fo-1', workspaceId: 'ws-1', externalOrderId: 'MOCK-order-1' });
  });

  it('rejects an envelope missing providerId/eventId before touching the DB', async () => {
    const handler = vi.fn();
    const result = await processFulfillmentWebhookEvent(makeEnvelope({ eventId: '' }), {}, handler);
    expect(result).toEqual({ status: 'rejected', reason: 'missing_provider_id_or_event_id' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature when a secret is supplied, never calling the handler', async () => {
    const envelope = makeEnvelope({ signatureHeader: 'not-the-real-signature' });
    const handler = vi.fn();
    const result = await processFulfillmentWebhookEvent(envelope, { secret: 'real-secret' }, handler);
    expect(result).toEqual({ status: 'rejected', reason: 'invalid_signature' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed, fresh event', async () => {
    const payload = { externalOrderId: 'MOCK-order-1', event: 'shipped' };
    const rawBody = JSON.stringify(payload);
    const secret = 'real-secret';
    const envelope = makeEnvelope({ rawBody, signatureHeader: sign(rawBody, secret) });
    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await processFulfillmentWebhookEvent(envelope, { secret }, handler);
    expect(result).toEqual({ status: 'processed' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale timestamp even with a valid signature (replay protection)', async () => {
    const payload = { externalOrderId: 'MOCK-order-1' };
    const rawBody = JSON.stringify(payload);
    const secret = 'real-secret';
    const envelope = makeEnvelope({ rawBody, signatureHeader: sign(rawBody, secret), timestamp: new Date(Date.now() - 10 * 60 * 1000) });
    const handler = vi.fn();

    const result = await processFulfillmentWebhookEvent(envelope, { secret, toleranceSeconds: 300 }, handler);
    expect(result).toEqual({ status: 'rejected', reason: 'timestamp_out_of_tolerance' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON payload', async () => {
    const handler = vi.fn();
    const result = await processFulfillmentWebhookEvent(makeEnvelope({ rawBody: 'not-json' }), {}, handler);
    expect(result).toEqual({ status: 'rejected', reason: 'invalid_json_payload' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a payload with no externalOrderId', async () => {
    const handler = vi.fn();
    const result = await processFulfillmentWebhookEvent(makeEnvelope({ payload: { event: 'shipped' } }), {}, handler);
    expect(result).toEqual({ status: 'rejected', reason: 'missing_external_order_id_in_payload' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an externalOrderId that matches no FulfillmentOrder — multi-tenant/unknown-order safety', async () => {
    const handler = vi.fn();
    const result = await processFulfillmentWebhookEvent(makeEnvelope({ payload: { externalOrderId: 'MOCK-does-not-exist' } }), {}, handler);
    expect(result).toEqual({ status: 'rejected', reason: 'unknown_external_order_id' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('resolves the workspace strictly from the matched FulfillmentOrder, never from the payload itself', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    // Payload carries no workspaceId at all — proves it is never read from there.
    await processFulfillmentWebhookEvent(makeEnvelope(), {}, handler);

    const log = [...webhookLogStore.values()][0];
    expect(log.workspaceId).toBe('ws-1'); // from fulfillmentOrderStore's own row, not invented
  });

  it('duplicate delivery of an already-processed event is skipped — handler never called twice', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await processFulfillmentWebhookEvent(makeEnvelope(), {}, handler);
    const result = await processFulfillmentWebhookEvent(makeEnvelope(), {}, handler);

    expect(result).toEqual({ status: 'skipped_duplicate' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a redelivery of a previously-failed event IS reprocessed (a legitimate retry, not swallowed)', async () => {
    const failingHandler = vi.fn().mockRejectedValueOnce(new Error('downstream error'));
    const firstResult = await processFulfillmentWebhookEvent(makeEnvelope(), {}, failingHandler);
    expect(firstResult).toEqual({ status: 'failed', error: 'downstream error' });

    const succeedingHandler = vi.fn().mockResolvedValue(undefined);
    const secondResult = await processFulfillmentWebhookEvent(makeEnvelope(), {}, succeedingHandler);
    expect(secondResult).toEqual({ status: 'processed' });
    expect(succeedingHandler).toHaveBeenCalledTimes(1);
  });

  it('a handler failure never leaks the raw body or signature into the stored error', async () => {
    const secretLookingBody = JSON.stringify({ externalOrderId: 'MOCK-order-1', apiKey: 'super-secret-value' });
    const envelope = makeEnvelope({ rawBody: secretLookingBody, signatureHeader: 'sig-abc' });
    const handler = vi.fn().mockRejectedValue(new Error('handler blew up'));

    await processFulfillmentWebhookEvent(envelope, {}, handler);

    const log = [...webhookLogStore.values()][0];
    expect(log.error).toBe('handler blew up');
    expect(log.error).not.toContain('super-secret-value');
    expect(log.error).not.toContain('sig-abc');
  });

  it('two concurrent deliveries of the same event: only one calls the handler', async () => {
    let resolveHandler: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        })
    );

    const first = processFulfillmentWebhookEvent(makeEnvelope(), {}, handler);
    // Give the first call's webhookLog.create a tick to win the race before the second starts.
    await new Promise((r) => setTimeout(r, 0));
    const second = await processFulfillmentWebhookEvent(makeEnvelope(), {}, handler);

    expect(second).toEqual({ status: 'skipped_duplicate' });
    resolveHandler!();
    await first;
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
