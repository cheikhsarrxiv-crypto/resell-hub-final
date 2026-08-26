/**
 * Next.js instrumentation hook — the officially supported place to run
 * startup code once per server runtime. Used here only to actually call
 * initializeSentry(), which existed in src/lib/sentry.ts but was never
 * invoked from anywhere, so error tracking never activated even with a
 * valid SENTRY_DSN configured.
 *
 * Node-only: Sentry.init() from @sentry/nextjs targets the Node SDK, and
 * middleware/edge routes run in a separate, more restricted runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeSentry } = await import('@/lib/sentry');
    initializeSentry();
  }
}
