import { describe, it, expect, afterEach } from 'vitest';
import { isRealEtsyPublishEnabled, describeEtsyEnvironment } from '@/services/ai/tools/etsyPublishGuard';

describe('isRealEtsyPublishEnabled — the absolute safeguard (Etsy)', () => {
  afterEach(() => {
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
  });

  it('is false when unset (the default in every environment this was built/tested in)', () => {
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
    expect(isRealEtsyPublishEnabled()).toBe(false);
  });

  it('is false for any value other than the exact string "true" — no dangerous truthy default', () => {
    for (const value of ['1', 'yes', 'on', 'TRUE', 'True', ' true', 'true ']) {
      process.env.ENABLE_REAL_ETSY_PUBLISH = value;
      expect(isRealEtsyPublishEnabled()).toBe(false);
    }
  });

  it('is true only for the exact string "true"', () => {
    process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
    expect(isRealEtsyPublishEnabled()).toBe(true);
  });

  it('is a separate flag from ENABLE_REAL_EBAY_PUBLISH — enabling one never enables the other', () => {
    process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
    expect(isRealEtsyPublishEnabled()).toBe(false);
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
  });
});

describe('describeEtsyEnvironment — display only, never a safety gate', () => {
  it('is always "production" — Etsy has no sandbox API to distinguish', () => {
    expect(describeEtsyEnvironment()).toBe('production');
  });
});
