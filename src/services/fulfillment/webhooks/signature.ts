import crypto from 'crypto';

/**
 * Generic HMAC-SHA256 webhook signature verification — the same real
 * primitive EbayAdapter.verifyWebhookSignature already uses
 * (crypto.createHmac('sha256', secret).update(payload).digest(...) +
 * crypto.timingSafeEqual), generalized here so it isn't reimplemented
 * per-partner. `encoding` defaults to 'hex' (the most common convention)
 * but accepts 'base64' (eBay's own convention) since no two partners are
 * guaranteed to agree — never assumed without that partner's real spec.
 *
 * Returns false (never throws) for a missing secret/signature or a
 * malformed signature header, exactly like EbayAdapter's own
 * verifyWebhookSignature — a webhook route should treat `false` as
 * "reject with 401", not as a crash.
 */
export function verifyHmacSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string | undefined;
  encoding?: 'hex' | 'base64';
}): boolean {
  const { rawBody, signatureHeader, secret, encoding = 'hex' } = params;
  if (!signatureHeader || !secret) return false;

  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest(encoding);
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(signatureHeader);
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

/**
 * Replay protection: a webhook claiming to be from further in the past
 * than `toleranceSeconds` is rejected even if its signature is valid — a
 * captured-and-replayed request eventually falls outside this window.
 * Also rejects a timestamp too far in the FUTURE (clock skew abuse), not
 * just too old.
 */
export function isWebhookTimestampFresh(timestamp: Date, toleranceSeconds = 300, now: Date = new Date()): boolean {
  const deltaMs = Math.abs(now.getTime() - timestamp.getTime());
  return deltaMs <= toleranceSeconds * 1000;
}
