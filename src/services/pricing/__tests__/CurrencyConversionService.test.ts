import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { CurrencyConversionService } from '@/services/pricing/CurrencyConversionService';

describe('CurrencyConversionService.convert', () => {
  afterEach(() => {
    delete process.env.CURRENCY_STATIC_RATES;
    delete process.env.FRANKFURTER_FX_ENABLED;
    vi.unstubAllGlobals();
  });

  it('identical currency -> rate 1, no conversion needed, no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await CurrencyConversionService.convert(100, 'EUR', 'EUR');

    expect(result).toEqual({ amount: 100, rate: 1, source: 'identical_currency' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('identical currency is case-insensitive', async () => {
    const result = await CurrencyConversionService.convert(100, 'eur', 'EUR');
    expect(result.source).toBe('identical_currency');
  });

  it('an explicit caller-provided rate is used and tagged as such, no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR', { explicitRates: { GBP_EUR: 1.17 } });

    expect(result).toEqual({ amount: 117, rate: 1.17, source: 'explicit_rate' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a configured static rate (env-supplied, not invented) is used and tagged as such, no network call', async () => {
    process.env.CURRENCY_STATIC_RATES = JSON.stringify({ GBP_EUR: 1.2 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');

    expect(result).toEqual({ amount: 120, rate: 1.2, source: 'configured_static_rate' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an explicit rate takes priority over a configured static rate', async () => {
    process.env.CURRENCY_STATIC_RATES = JSON.stringify({ GBP_EUR: 1.2 });
    const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR', { explicitRates: { GBP_EUR: 1.5 } });
    expect(result.rate).toBe(1.5);
    expect(result.source).toBe('explicit_rate');
  });

  it('a configured static rate takes priority over Frankfurter (tier 3 before tier 4)', async () => {
    process.env.CURRENCY_STATIC_RATES = JSON.stringify({ GBP_EUR: 1.2 });
    process.env.FRANKFURTER_FX_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');

    expect(result.source).toBe('configured_static_rate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('Frankfurter tier (only consulted when nothing else answered)', () => {
    beforeEach(() => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
    });

    it('a successful Frankfurter response is used, tagged ecb_reference_rate, with rate date preserved', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ amount: 1, base: 'GBP', date: '2026-09-17', rates: { EUR: 1.18 } }),
        })
      );

      const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');

      expect(result.amount).toBe(118);
      expect(result.rate).toBe(1.18);
      expect(result.source).toBe('ecb_reference_rate');
      expect(result.asOf).toBe('2026-09-17');
      expect(result.providerName).toBe('frankfurter');
    });

    it('Frankfurter disabled (FRANKFURTER_FX_ENABLED not "true") -> never called, falls straight to unavailable', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'false';
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.source).toBe('unavailable');
    });

    it('Frankfurter HTTP error -> unavailable, never a guessed rate', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

      const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');

      expect(result).toEqual({ amount: null, rate: null, source: 'unavailable' });
    });

    it('Frankfurter timeout -> unavailable, never a guessed rate', async () => {
      const timeoutError = new Error('aborted');
      timeoutError.name = 'TimeoutError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');

      expect(result.source).toBe('unavailable');
    });

    it('a currency Frankfurter does not cover -> unavailable, never a guessed rate', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ amount: 1, base: 'GBP', date: '2026-09-17', rates: {} }) })
      );

      const result = await CurrencyConversionService.convert(100, 'GBP', 'ZZZ');

      expect(result.source).toBe('unavailable');
    });
  });

  it('an unknown currency pair with nothing configured anywhere -> unavailable, never a guessed number', async () => {
    const result = await CurrencyConversionService.convert(100, 'GBP', 'JPY');
    expect(result).toEqual({ amount: null, rate: null, source: 'unavailable' });
  });

  it('malformed CURRENCY_STATIC_RATES JSON is ignored, not a crash, and still reports unavailable', async () => {
    process.env.CURRENCY_STATIC_RATES = '{not valid json';
    const result = await CurrencyConversionService.convert(100, 'GBP', 'EUR');
    expect(result.source).toBe('unavailable');
  });
});

describe('CurrencyConversionService.isConfigured', () => {
  afterEach(() => {
    delete process.env.CURRENCY_STATIC_RATES;
    delete process.env.FRANKFURTER_FX_ENABLED;
  });

  it('is false with nothing configured', () => {
    expect(CurrencyConversionService.isConfigured()).toBe(false);
  });

  it('is true once at least one static rate is configured', () => {
    process.env.CURRENCY_STATIC_RATES = JSON.stringify({ GBP_EUR: 1.17 });
    expect(CurrencyConversionService.isConfigured()).toBe(true);
  });

  it('is true once Frankfurter is enabled', () => {
    process.env.FRANKFURTER_FX_ENABLED = 'true';
    expect(CurrencyConversionService.isConfigured()).toBe(true);
  });
});
