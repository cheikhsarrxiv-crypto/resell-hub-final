/**
 * The app's public base URL (e.g. https://www.adksy.org), used to build
 * links embedded in emails (verification, welcome, order notifications).
 * NEXTAUTH_URL is already required for NextAuth itself to work correctly,
 * so a production deployment missing it is a real misconfiguration — this
 * throws rather than silently falling back to localhost, which would
 * embed a dead link in an email actually sent to a user. The localhost
 * fallback is kept for local dev/test only, where NEXTAUTH_URL is
 * routinely unset.
 */
export function getAppUrl(): string {
  const url = process.env.NEXTAUTH_URL;
  if (url) return url;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXTAUTH_URL is not configured in production');
  }

  return 'http://localhost:3000';
}
