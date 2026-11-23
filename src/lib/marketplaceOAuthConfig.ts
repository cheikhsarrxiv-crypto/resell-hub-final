/**
 * B.11.1 — fail-closed validation of the eBay OAuth configuration (connect + callback).
 *
 * Before: `sandboxMode = EBAY_SANDBOX_MODE !== 'false'`, empty strings for missing credentials and a
 * silent `localhost` callback fallback. Nothing stopped a Preview from running with the production
 * environment, a production Client ID with the Sandbox hosts (or the reverse), or a malformed variable.
 *
 * Rules (pure function of the environment: no network, no call to eBay, no secret in any output):
 *  1. EBAY_SANDBOX_MODE: absent/empty -> Sandbox (default kept); exactly 'true' -> Sandbox; exactly 'false' ->
 *     Production; ANY other value (' false', 'FALSE', '0', 'no') is ambiguous -> refused.
 *  2. Production is only possible on a production runtime: VERCEL_ENV === 'production', or (no VERCEL_ENV and
 *     NODE_ENV === 'production'). A Preview/Development deployment or a local dev server with
 *     EBAY_SANDBOX_MODE=false is refused.
 *  3. Client ID and secret must be present and without surrounding/inner whitespace.
 *  4. eBay Client IDs conventionally contain `-SBX-` (Sandbox keyset) or `-PRD-` (Production keyset). This is
 *     an observed naming convention, NOT a documented guarantee, so it is used ONLY to REFUSE a contradiction
 *     (Sandbox mode + `-PRD-`, Production mode + `-SBX-`, or both markers). An ID with no marker is accepted and
 *     reported as `clientIdEnvironmentVerified: false`: the keyset must then be checked by hand (see docs).
 *  5. The redirect value (eBay's `redirect_uri` parameter is the RuName, which ADKSY reads from
 *     EBAY_REDIRECT_URI) is required (no localhost fallback). If it is a URL it must be https (http only for
 *     localhost outside Vercel), have no credentials/query/hash, end with /api/marketplace/callback/ebay and,
 *     when NEXTAUTH_URL is set, use the same host. Otherwise it is treated as a RuName (letters, digits, `.`,
 *     `_`, `-`). Whether a RuName really points to this deployment CANNOT be verified here: manual check.
 */

export type MarketplaceConfigReason =
  | 'invalid_sandbox_mode'
  | 'production_not_allowed_on_this_runtime'
  | 'missing_client_id'
  | 'missing_client_secret'
  | 'malformed_client_id'
  | 'malformed_client_secret'
  | 'client_id_environment_mismatch'
  | 'missing_redirect'
  | 'malformed_redirect'
  | 'insecure_redirect'
  | 'redirect_path_mismatch'
  | 'redirect_host_mismatch';

/** Carries only a reason code: never a value, a secret or an upstream message. */
export class MarketplaceConfigError extends Error {
  readonly reason: MarketplaceConfigReason;
  constructor(reason: MarketplaceConfigReason) {
    super(`Marketplace configuration refused (${reason})`);
    this.name = 'MarketplaceConfigError';
    this.reason = reason;
  }
}

export interface EbayOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sandboxMode: boolean;
  environment: 'sandbox' | 'production';
  /** true only when the Client ID carries the marker matching `environment`; false = manual check required. */
  clientIdEnvironmentVerified: boolean;
  /** 'url' (callback URL checked) or 'runame' (format only; target cannot be verified). */
  redirectKind: 'url' | 'runame';
}

type Env = Record<string, string | undefined>;

const CALLBACK_PATH = '/api/marketplace/callback/ebay';
const hasWhitespace = (v: string) => /\s/.test(v);
const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';

function runtimeAllowsProduction(env: Env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production';
}

export function resolveEbayOAuthConfig(env: Env = process.env): EbayOAuthConfig {
  // 1. mode
  const rawMode = env.EBAY_SANDBOX_MODE;
  let sandboxMode: boolean;
  if (rawMode === undefined || rawMode === '' || rawMode === 'true') sandboxMode = true;
  else if (rawMode === 'false') sandboxMode = false;
  else throw new MarketplaceConfigError('invalid_sandbox_mode');

  // 2. production only on a production runtime
  if (!sandboxMode && !runtimeAllowsProduction(env)) {
    throw new MarketplaceConfigError('production_not_allowed_on_this_runtime');
  }

  // 3. credentials
  const clientId = env.EBAY_CLIENT_ID ?? '';
  const clientSecret = env.EBAY_CLIENT_SECRET ?? '';
  if (!clientId) throw new MarketplaceConfigError('missing_client_id');
  if (!clientSecret) throw new MarketplaceConfigError('missing_client_secret');
  if (hasWhitespace(clientId) || clientId.length > 200) throw new MarketplaceConfigError('malformed_client_id');
  if (hasWhitespace(clientSecret) || clientSecret.length > 400) throw new MarketplaceConfigError('malformed_client_secret');

  // 4. keyset marker: used to refuse contradictions only
  const upper = clientId.toUpperCase();
  const looksSandbox = upper.includes('-SBX-');
  const looksProduction = upper.includes('-PRD-');
  if ((looksSandbox && looksProduction) || (sandboxMode && looksProduction) || (!sandboxMode && looksSandbox)) {
    throw new MarketplaceConfigError('client_id_environment_mismatch');
  }
  const clientIdEnvironmentVerified = sandboxMode ? looksSandbox : looksProduction;

  // 5. redirect (RuName or callback URL)
  const redirectUri = env.EBAY_REDIRECT_URI ?? '';
  if (!redirectUri) throw new MarketplaceConfigError('missing_redirect');
  if (hasWhitespace(redirectUri) || redirectUri.length > 512) throw new MarketplaceConfigError('malformed_redirect');

  let redirectKind: 'url' | 'runame';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(redirectUri)) {
    redirectKind = 'url';
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new MarketplaceConfigError('malformed_redirect');
    }
    if (url.username || url.password || url.search || url.hash) throw new MarketplaceConfigError('malformed_redirect');
    const local = isLocalHost(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !env.VERCEL_ENV)) {
      throw new MarketplaceConfigError('insecure_redirect');
    }
    if (url.pathname !== CALLBACK_PATH) throw new MarketplaceConfigError('redirect_path_mismatch');
    if (env.NEXTAUTH_URL) {
      let appHost: string | null = null;
      try {
        appHost = new URL(env.NEXTAUTH_URL).host;
      } catch {
        appHost = null;
      }
      if (!appHost || appHost !== url.host) throw new MarketplaceConfigError('redirect_host_mismatch');
    }
  } else {
    redirectKind = 'runame';
    if (!/^[A-Za-z0-9._-]{3,128}$/.test(redirectUri)) throw new MarketplaceConfigError('malformed_redirect');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    sandboxMode,
    environment: sandboxMode ? 'sandbox' : 'production',
    clientIdEnvironmentVerified,
    redirectKind,
  };
}

export interface MarketplaceConnectionConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sandboxMode: boolean;
}

/** Config handed to MarketplaceConnectionService by connect and callback. Etsy is unchanged (no sandbox). */
export function getMarketplaceConnectionConfig(marketplace: 'ebay' | 'etsy', env: Env = process.env): MarketplaceConnectionConfig {
  if (marketplace === 'ebay') {
    const c = resolveEbayOAuthConfig(env);
    return { clientId: c.clientId, clientSecret: c.clientSecret, redirectUri: c.redirectUri, sandboxMode: c.sandboxMode };
  }
  return {
    clientId: env.ETSY_CLIENT_ID || '',
    clientSecret: env.ETSY_CLIENT_SECRET || '',
    redirectUri: env.ETSY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/etsy',
    sandboxMode: false,
  };
}
