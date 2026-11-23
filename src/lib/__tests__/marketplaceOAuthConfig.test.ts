/**
 * B.11.1 — fail-closed validation of the eBay OAuth configuration. Pure: an explicit env object is passed,
 * nothing reads process.env, nothing contacts eBay.
 */
import { describe, it, expect } from 'vitest';
import { resolveEbayOAuthConfig, getMarketplaceConnectionConfig, MarketplaceConfigError } from '@/lib/marketplaceOAuthConfig';

const SECRET = 'S3cr3t-value-that-must-never-leak';
const SBX_ID = 'Adksy-Adksy-SBX-0123456789-abcdef01';
const PRD_ID = 'Adksy-Adksy-PRD-0123456789-abcdef01';
const RUNAME = 'Adksy-Adksy-Adksy-abcdefg';
const URL_OK = 'https://preview.example.test/api/marketplace/callback/ebay';

const sandboxEnv = (o: Record<string, string | undefined> = {}) => ({
  EBAY_SANDBOX_MODE: 'true', EBAY_CLIENT_ID: SBX_ID, EBAY_CLIENT_SECRET: SECRET, EBAY_REDIRECT_URI: RUNAME, VERCEL_ENV: 'preview', ...o,
});
const prodEnv = (o: Record<string, string | undefined> = {}) => ({
  EBAY_SANDBOX_MODE: 'false', EBAY_CLIENT_ID: PRD_ID, EBAY_CLIENT_SECRET: SECRET, EBAY_REDIRECT_URI: RUNAME, VERCEL_ENV: 'production', ...o,
});
const reasonOf = (env: Record<string, string | undefined>) => {
  try { resolveEbayOAuthConfig(env); return null; } catch (e) { expect(e).toBeInstanceOf(MarketplaceConfigError); return (e as MarketplaceConfigError).reason; }
};

describe('mode', () => {
  it('explicit Sandbox', () => {
    const c = resolveEbayOAuthConfig(sandboxEnv());
    expect(c).toMatchObject({ sandboxMode: true, environment: 'sandbox', clientIdEnvironmentVerified: true, redirectKind: 'runame' });
  });
  it.each([undefined, ''])('EBAY_SANDBOX_MODE=%j -> Sandbox by default (rule kept)', (v) => {
    expect(resolveEbayOAuthConfig(sandboxEnv({ EBAY_SANDBOX_MODE: v })).sandboxMode).toBe(true);
  });
  it.each(['FALSE', 'False', '0', 'no', ' false', 'false ', 'TRUE', '1', 'yes', 'sandbox', 'null'])('ambiguous value %j is refused (fail closed), not silently Sandbox or Production', (v) => {
    expect(reasonOf(sandboxEnv({ EBAY_SANDBOX_MODE: v }))).toBe('invalid_sandbox_mode');
  });
  it('explicit Production on a production runtime', () => {
    const c = resolveEbayOAuthConfig(prodEnv());
    expect(c).toMatchObject({ sandboxMode: false, environment: 'production', clientIdEnvironmentVerified: true });
  });
  it.each(['preview', 'development'])('Production mode on a Vercel %s deployment is refused', (vercelEnv) => {
    expect(reasonOf(prodEnv({ VERCEL_ENV: vercelEnv }))).toBe('production_not_allowed_on_this_runtime');
  });
  it('Production mode outside Vercel needs NODE_ENV=production (a local dev server is refused)', () => {
    expect(reasonOf(prodEnv({ VERCEL_ENV: undefined, NODE_ENV: 'development' }))).toBe('production_not_allowed_on_this_runtime');
    expect(reasonOf(prodEnv({ VERCEL_ENV: undefined, NODE_ENV: undefined }))).toBe('production_not_allowed_on_this_runtime');
    expect(reasonOf(prodEnv({ VERCEL_ENV: undefined, NODE_ENV: 'production' }))).toBeNull();
  });
  it('Sandbox works on every runtime', () => {
    for (const v of ['preview', 'development', 'production', undefined]) expect(reasonOf(sandboxEnv({ VERCEL_ENV: v }))).toBeNull();
  });
});

describe('credentials', () => {
  it.each([['EBAY_CLIENT_ID', 'missing_client_id'], ['EBAY_CLIENT_SECRET', 'missing_client_secret'], ['EBAY_REDIRECT_URI', 'missing_redirect']])('%s absent -> %s (no localhost fallback)', (key, reason) => {
    expect(reasonOf(sandboxEnv({ [key]: undefined }))).toBe(reason);
    expect(reasonOf(sandboxEnv({ [key]: '' }))).toBe(reason);
  });
  it.each([' ' + SBX_ID, SBX_ID + '\n', 'Adksy Adksy-SBX-1234567890', 'x'.repeat(201)])('malformed Client ID %j refused', (id) => {
    expect(reasonOf(sandboxEnv({ EBAY_CLIENT_ID: id }))).toBe('malformed_client_id');
  });
  it.each([SECRET + ' ', ' ' + SECRET, 'a b'])('malformed secret refused', (secret) => {
    expect(reasonOf(sandboxEnv({ EBAY_CLIENT_SECRET: secret }))).toBe('malformed_client_secret');
  });
});

describe('Sandbox/Production keyset consistency (contradictions only: the marker is a convention, not proof)', () => {
  it('Sandbox mode with a Production-looking Client ID -> refused', () => {
    expect(reasonOf(sandboxEnv({ EBAY_CLIENT_ID: PRD_ID }))).toBe('client_id_environment_mismatch');
  });
  it('Production mode with a Sandbox-looking Client ID -> refused', () => {
    expect(reasonOf(prodEnv({ EBAY_CLIENT_ID: SBX_ID }))).toBe('client_id_environment_mismatch');
  });
  it('an ID carrying both markers is ambiguous -> refused', () => {
    expect(reasonOf(sandboxEnv({ EBAY_CLIENT_ID: 'A-SBX-B-PRD-C-0123456789' }))).toBe('client_id_environment_mismatch');
  });
  it('lower case markers are detected too', () => {
    expect(reasonOf(sandboxEnv({ EBAY_CLIENT_ID: 'adksy-adksy-prd-0123456789' }))).toBe('client_id_environment_mismatch');
  });
  it('an ID with no marker is accepted but NOT reported as verified (manual check required)', () => {
    const c = resolveEbayOAuthConfig(sandboxEnv({ EBAY_CLIENT_ID: 'plain-client-id-0123456789' }));
    expect(c.clientIdEnvironmentVerified).toBe(false);
  });
});

describe('redirect (RuName or callback URL)', () => {
  it('a RuName is accepted by format only', () => {
    expect(resolveEbayOAuthConfig(sandboxEnv()).redirectKind).toBe('runame');
  });
  it.each(['ab', 'has space', 'a/b/c', 'localhost:3000', 'x'.repeat(129), 'ru;name'])('malformed RuName %j refused', (v) => {
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: v }))).toBe('malformed_redirect');
  });
  it('an https callback URL on the right path is accepted', () => {
    expect(resolveEbayOAuthConfig(sandboxEnv({ EBAY_REDIRECT_URI: URL_OK })).redirectKind).toBe('url');
  });
  it('http is refused on Vercel, and for non-local hosts anywhere', () => {
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: 'http://preview.example.test/api/marketplace/callback/ebay' }))).toBe('insecure_redirect');
    expect(reasonOf(sandboxEnv({ VERCEL_ENV: undefined, EBAY_REDIRECT_URI: 'http://preview.example.test/api/marketplace/callback/ebay' }))).toBe('insecure_redirect');
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: 'http://localhost:3000/api/marketplace/callback/ebay' }))).toBe('insecure_redirect');
  });
  it('http://localhost is allowed for a local server only (no VERCEL_ENV)', () => {
    expect(reasonOf(sandboxEnv({ VERCEL_ENV: undefined, EBAY_REDIRECT_URI: 'http://localhost:3000/api/marketplace/callback/ebay' }))).toBeNull();
  });
  it.each([
    ['wrong path', 'https://preview.example.test/api/marketplace/callback/etsy', 'redirect_path_mismatch'],
    ['root path', 'https://preview.example.test/', 'redirect_path_mismatch'],
    ['query', URL_OK + '?x=1', 'malformed_redirect'],
    ['fragment', URL_OK + '#x', 'malformed_redirect'],
    ['credentials', 'https://user:pw@preview.example.test/api/marketplace/callback/ebay', 'malformed_redirect'],
    ['unparsable', 'https://', 'malformed_redirect'],
  ])('callback URL with %s refused', (_n, uri, reason) => {
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: uri }))).toBe(reason);
  });
  it('callback host must equal the NEXTAUTH_URL host (a Preview pointing at another deployment is refused)', () => {
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: URL_OK, NEXTAUTH_URL: 'https://preview.example.test' }))).toBeNull();
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: URL_OK, NEXTAUTH_URL: 'https://www.other-site.test' }))).toBe('redirect_host_mismatch');
    expect(reasonOf(sandboxEnv({ EBAY_REDIRECT_URI: URL_OK, NEXTAUTH_URL: 'not a url' }))).toBe('redirect_host_mismatch');
  });
});

describe('no leak, no side effect', () => {
  it('no error message ever contains a credential, an id or the redirect value', () => {
    const envs = [
      sandboxEnv({ EBAY_SANDBOX_MODE: 'FALSE' }), prodEnv({ VERCEL_ENV: 'preview' }), sandboxEnv({ EBAY_CLIENT_ID: PRD_ID }),
      sandboxEnv({ EBAY_CLIENT_SECRET: SECRET + ' ' }), sandboxEnv({ EBAY_REDIRECT_URI: 'ru;name' }),
    ];
    for (const env of envs) {
      try { resolveEbayOAuthConfig(env); throw new Error('should have thrown'); } catch (e) {
        const text = String((e as Error).message) + JSON.stringify(e);
        for (const secretish of [SECRET, SBX_ID, PRD_ID, RUNAME, 'ru;name']) expect(text).not.toContain(secretish);
      }
    }
  });
  it('the resolved config never changes the inputs it is given and performs no I/O (pure)', () => {
    const env = sandboxEnv();
    const copy = { ...env };
    resolveEbayOAuthConfig(env);
    expect(env).toEqual(copy);
  });
});

describe('getMarketplaceConnectionConfig', () => {
  it('eBay: returns exactly what the adapter needs, validated', () => {
    expect(getMarketplaceConnectionConfig('ebay', sandboxEnv())).toEqual({ clientId: SBX_ID, clientSecret: SECRET, redirectUri: RUNAME, sandboxMode: true });
  });
  it('eBay: a refused configuration throws instead of returning empty strings', () => {
    expect(() => getMarketplaceConnectionConfig('ebay', {})).toThrow(MarketplaceConfigError);
  });
  it('Etsy: unchanged behaviour (no sandbox, no new validation)', () => {
    expect(getMarketplaceConnectionConfig('etsy', { ETSY_CLIENT_ID: 'id', ETSY_CLIENT_SECRET: 's', ETSY_REDIRECT_URI: 'https://x.test/cb' })).toEqual({
      clientId: 'id', clientSecret: 's', redirectUri: 'https://x.test/cb', sandboxMode: false,
    });
  });
});
