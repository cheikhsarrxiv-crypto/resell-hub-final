/**
 * Phase 10 production-readiness fix — regression test for a real bug
 * found during the audit: StripeService used to construct its Stripe
 * client at MODULE LEVEL (`const stripe = new Stripe(process.env.
 * STRIPE_SECRET_KEY!, {})`). Verified directly against the real Stripe
 * SDK: `new Stripe(undefined, {})` throws immediately ("Neither apiKey
 * nor config.authenticator provided") — so simply IMPORTING StripeService
 * (which /api/stripe/checkout, /api/stripe/webhooks, and /api/stripe/portal
 * all do) used to crash outright in any environment missing
 * STRIPE_SECRET_KEY (a preview deployment, a misconfigured environment, or
 * — a known Next.js/Vercel gotcha — during `next build` itself), rather
 * than failing only when Stripe is genuinely used. Two other test files in
 * this same directory (stripe-payment-failed-email.test.ts,
 * stripe-payment-failed-metadata.test.ts) even had to work around this
 * locally by pre-seeding a placeholder STRIPE_SECRET_KEY before import,
 * with a comment noting exactly this throw — real, pre-existing evidence
 * of the bug, not a hypothetical.
 *
 * Fixed by constructing the client lazily (on first real use, cached
 * after) instead of at module load. This file proves both halves of the
 * fix: importing StripeService with NO key set must never throw, and
 * actually calling a Stripe-touching method with no key set must still
 * fail — clearly, when Stripe is genuinely needed — never silently.
 *
 * Same env-var isolation pattern as email-service-resend-error.test.ts:
 * vi.resetModules() + a fresh dynamic import per test, since the module
 * under test reads process.env at (lazy) construction time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('StripeService — lazy Stripe client initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('importing StripeService with STRIPE_SECRET_KEY unset never throws', async () => {
    await expect(import('@/services/StripeService')).resolves.toBeDefined();
  });

  it('calling a Stripe-touching method with STRIPE_SECRET_KEY still unset fails clearly, not silently — the lazy getter genuinely still requires a real key', async () => {
    const { StripeService } = await import('@/services/StripeService');

    // createCheckoutSession's own first real DB check (plan lookup) will
    // fail before ever reaching Stripe in this unmocked environment — so
    // we exercise the narrower, more direct verifyWebhookSignature path,
    // which calls getStripeClient().webhooks.constructEvent synchronously
    // and requires nothing else (no DB) to reach the real Stripe SDK call.
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    expect(() => StripeService.verifyWebhookSignature('{}', 'sig')).toThrow(/apiKey|authenticator/i);
  });

  it('a real key present at call time works — the client is genuinely usable once configured, not permanently broken by the lazy pattern', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit_test_placeholder_not_real';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const { StripeService } = await import('@/services/StripeService');

    // constructEvent still throws (the signature/payload aren't real), but
    // NOT for a missing-apiKey reason — proving the client itself
    // constructed successfully once a key was actually present.
    expect(() => StripeService.verifyWebhookSignature('{}', 'sig')).not.toThrow(/apiKey|authenticator/i);
  });
});
