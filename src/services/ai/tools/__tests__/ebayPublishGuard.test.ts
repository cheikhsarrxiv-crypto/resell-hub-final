import { describe, it, expect, afterEach } from 'vitest';
import { isRealEbayPublishEnabled, describeEbayEnvironment } from '@/services/ai/tools/ebayPublishGuard';

describe('isRealEbayPublishEnabled — the absolute safeguard', () => {
  afterEach(() => {
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
  });

  it('is false when unset (the default in every environment this was built/tested in)', () => {
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
    expect(isRealEbayPublishEnabled()).toBe(false);
  });

  it('is false for any value other than the exact string "true" — no dangerous truthy default', () => {
    for (const value of ['1', 'yes', 'on', 'TRUE', 'True', ' true', 'true ']) {
      process.env.ENABLE_REAL_EBAY_PUBLISH = value;
      expect(isRealEbayPublishEnabled()).toBe(false);
    }
  });

  it('is true only for the exact string "true"', () => {
    process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
    expect(isRealEbayPublishEnabled()).toBe(true);
  });
});

describe('describeEbayEnvironment — display only, never a safety gate', () => {
  afterEach(() => {
    delete process.env.EBAY_SANDBOX_MODE;
  });

  it('defaults to sandbox when unset — the safe default', () => {
    delete process.env.EBAY_SANDBOX_MODE;
    expect(describeEbayEnvironment()).toBe('sandbox');
  });

  it('is production only when explicitly set to the exact string "false"', () => {
    process.env.EBAY_SANDBOX_MODE = 'false';
    expect(describeEbayEnvironment()).toBe('production');
  });

  it('any other value stays sandbox — no accidental production selection', () => {
    process.env.EBAY_SANDBOX_MODE = 'FALSE';
    expect(describeEbayEnvironment()).toBe('sandbox');
  });
});
