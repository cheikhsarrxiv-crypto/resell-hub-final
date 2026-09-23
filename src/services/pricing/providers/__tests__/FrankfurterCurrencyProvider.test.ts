import { describe, it, expect, afterEach, vi } from 'vitest';
import { FrankfurterCurrencyProvider } from '@/services/pricing/providers/FrankfurterCurrencyProvider';

describe('FrankfurterCurrencyProvider', () => {
  afterEach(() => {
    delete process.env.FRANKFURTER_FX_ENABLED;
    vi.unstubAllGlobals();
  });

  describe('isConfigured', () => {
    it('is false by default (opt-in required)', () => {
      expect(new FrankfurterCurrencyProvider().isConfigured()).toBe(false);
    });

    it('is true only when set to exactly "true"', () => {
      process.env.FRANKFURTER_FX_ENABLED = 'yes';
      expect(new FrankfurterCurrencyProvider().isConfigured()).toBe(false);
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      expect(new FrankfurterCurrencyProvider().isConfigured()).toBe(true);
    });
  });

  describe('getRate', () => {
    it('returns null without ever calling fetch when not configured', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await new FrankfurterCurrencyProvider().getRate('GBP', 'EUR');

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requests the correct endpoint and params when configured', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: '2026-09-17', rates: { EUR: 1.18 } }) });
      vi.stubGlobal('fetch', fetchMock);

      await new FrankfurterCurrencyProvider().getRate('GBP', 'EUR');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('api.frankfurter.dev');
      expect(url).toContain('from=GBP');
      expect(url).toContain('to=EUR');
    });

    it('returns the rate tagged ecb_reference_rate, with the reported date, when configured and successful', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: '2026-09-17', rates: { EUR: 1.18 } }) }));

      const result = await new FrankfurterCurrencyProvider().getRate('GBP', 'EUR');

      expect(result).toEqual({ rate: 1.18, asOf: '2026-09-17', source: 'ecb_reference_rate' });
    });

    it('a non-ok HTTP response -> null, never a fabricated rate', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

      const result = await new FrankfurterCurrencyProvider().getRate('GBP', 'EUR');

      expect(result).toBeNull();
    });

    it('a network/timeout failure -> null, never a fabricated rate', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      const timeoutError = new Error('aborted');
      timeoutError.name = 'TimeoutError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      const result = await new FrankfurterCurrencyProvider().getRate('GBP', 'EUR');

      expect(result).toBeNull();
    });

    it('a currency Frankfurter has no rate for -> null, never a fabricated rate', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: '2026-09-17', rates: {} }) }));

      const result = await new FrankfurterCurrencyProvider().getRate('GBP', 'ZZZ');

      expect(result).toBeNull();
    });

    it('a malformed JSON response -> null, never a crash', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } }));

      const result = await new FrankfurterCurrencyProvider().getRate('GBP', 'EUR');

      expect(result).toBeNull();
    });
  });
});
