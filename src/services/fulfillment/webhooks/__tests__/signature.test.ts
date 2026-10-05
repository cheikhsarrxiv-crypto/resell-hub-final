import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyHmacSignature, isWebhookTimestampFresh } from '@/services/fulfillment/webhooks/signature';

describe('verifyHmacSignature', () => {
  const secret = 'test-webhook-secret';
  const rawBody = JSON.stringify({ externalOrderId: 'MOCK-order-1', event: 'shipped' });

  function sign(body: string, s = secret, encoding: 'hex' | 'base64' = 'hex') {
    return crypto.createHmac('sha256', s).update(body).digest(encoding);
  }

  it('accepts a correctly computed hex signature', () => {
    const signatureHeader = sign(rawBody);
    expect(verifyHmacSignature({ rawBody, signatureHeader, secret })).toBe(true);
  });

  it('accepts a correctly computed base64 signature when encoding is specified', () => {
    const signatureHeader = sign(rawBody, secret, 'base64');
    expect(verifyHmacSignature({ rawBody, signatureHeader, secret, encoding: 'base64' })).toBe(true);
  });

  it('rejects a tampered body (signature computed over different bytes)', () => {
    const signatureHeader = sign(rawBody);
    const tamperedBody = JSON.stringify({ externalOrderId: 'MOCK-order-1', event: 'cancelled' });
    expect(verifyHmacSignature({ rawBody: tamperedBody, signatureHeader, secret })).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const signatureHeader = sign(rawBody, 'wrong-secret');
    expect(verifyHmacSignature({ rawBody, signatureHeader, secret })).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyHmacSignature({ rawBody, signatureHeader: null, secret })).toBe(false);
  });

  it('rejects a missing secret, never throwing', () => {
    expect(verifyHmacSignature({ rawBody, signatureHeader: sign(rawBody), secret: undefined })).toBe(false);
  });

  it('never throws on a malformed signature header', () => {
    expect(() => verifyHmacSignature({ rawBody, signatureHeader: 'not-hex-$$$', secret })).not.toThrow();
    expect(verifyHmacSignature({ rawBody, signatureHeader: 'not-hex-$$$', secret })).toBe(false);
  });
});

describe('isWebhookTimestampFresh', () => {
  it('accepts a timestamp right now', () => {
    expect(isWebhookTimestampFresh(new Date(), 300)).toBe(true);
  });

  it('accepts a timestamp just inside the tolerance window', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const timestamp = new Date('2026-01-01T00:04:00Z'); // 240s before "now"
    expect(isWebhookTimestampFresh(timestamp, 300, now)).toBe(true);
  });

  it('rejects a timestamp older than the tolerance window (stale/replayed)', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const timestamp = new Date('2026-01-01T00:00:00Z'); // 600s before "now"
    expect(isWebhookTimestampFresh(timestamp, 300, now)).toBe(false);
  });

  it('rejects a timestamp too far in the future (clock-skew abuse)', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const timestamp = new Date('2026-01-01T00:10:00Z'); // 600s after "now"
    expect(isWebhookTimestampFresh(timestamp, 300, now)).toBe(false);
  });
});
