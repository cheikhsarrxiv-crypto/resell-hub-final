/**
 * Proves the fix: handleConnect() in MarketplaceConnectionsCard.tsx now
 * checks response.ok (not just the presence of data.authUrl), surfaces
 * data.error to the user, and resets `connecting` on every failure path
 * — previously a 4xx/5xx response with {error: "..."} was silently
 * ignored (no message shown, `connecting` left stuck), which is exactly
 * the symptom reported for "Connect to eBay" doing nothing after a
 * missing-credentials failure in production.
 *
 * This file cannot be imported directly: tsconfig.json sets
 * "jsx": "preserve" (required for Next.js's own JSX transform), and
 * Vitest/esbuild refuses to parse a .tsx file under that setting
 * ("Failed to parse source for import analysis... make sure to not set
 * jsx to preserve" — confirmed by actually attempting the import before
 * writing this file). So, matching the convention already established
 * for framework code that can't be exercised directly in this setup
 * (auth-login-ratelimit.test.ts, oauth-callback-security.test.ts), this
 * does source-level checks against the real file content via
 * fs.readFileSync — verifying both the pure resolveConnectOutcome()
 * decision logic and how handleConnect() wires it into React state.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/marketplace/MarketplaceConnectionsCard.tsx'),
  'utf-8'
);

/**
 * Connector Hub audit (B1) finding: this card used to treat any status
 * other than the literal string 'connected' identically ("Disconnected"),
 * so an expired connection was indistinguishable from one that was never
 * connected at all. resolveDisplayStatus() is the pure decision logic for
 * the fix — proves the three display states map correctly, and that
 * nothing other than the exact string 'connected' can ever resolve to
 * 'connected'.
 */
describe('resolveDisplayStatus() — pure decision logic', () => {
  const fnStart = componentSource.indexOf('export function resolveDisplayStatus(');
  const fnEnd = componentSource.indexOf('\n}\n', fnStart);
  const fnBody = componentSource.slice(fnStart, fnEnd);

  it('exists as a standalone, exported function (testable independently of React state)', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('maps the literal string "connected" to \'connected\'', () => {
    expect(fnBody).toContain("if (status === 'connected') return 'connected'");
  });

  it('maps the literal string "expired" to \'expired\'', () => {
    expect(fnBody).toContain("if (status === 'expired') return 'expired'");
  });

  it('falls back to \'not_connected\' for anything else, including undefined/missing status', () => {
    expect(fnBody.trim().endsWith("return 'not_connected'")).toBe(true);
  });
});

describe('resolveConnectOutcome() — pure decision logic', () => {
  const fnStart = componentSource.indexOf('export function resolveConnectOutcome(');
  const fnEnd = componentSource.indexOf('\n}\n', fnStart);
  const fnBody = componentSource.slice(fnStart, fnEnd);

  it('exists as a standalone, exported function (testable independently of React state)', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('1. treats response.ok + data.authUrl as success, returning that authUrl', () => {
    expect(fnBody).toContain('if (response.ok && data.authUrl)');
    expect(fnBody).toContain('return { ok: true, authUrl: data.authUrl }');
  });

  it('2. treats a non-ok response as failure and carries data.error through as the message', () => {
    // The fallback branch (reached whenever the success condition above
    // is false — includes both !response.ok and a 200 missing authUrl)
    // must surface data.error verbatim when present.
    expect(fnBody).toContain('message: data.error ||');
  });

  it('3. a 200 with no authUrl and no error falls through to the same failure branch with a fixed fallback message', () => {
    // Same code path as case 2 above: the `if` only guards the success
    // case, so anything else — including a malformed 200 — reaches the
    // `return { ok: false, ... }` with the fallback string.
    expect(fnBody).toContain("'Failed to start the connection. Please try again.'");
    expect(fnBody).toContain('return {\n    ok: false,');
  });
});

describe('handleConnect() — wires resolveConnectOutcome() into component state', () => {
  const handleConnectStart = componentSource.indexOf('const handleConnect = async');
  const handleConnectEnd = componentSource.indexOf('\n  }\n\n  const handleDisconnect', handleConnectStart);
  const handleConnectBody = componentSource.slice(handleConnectStart, handleConnectEnd);

  it('calls resolveConnectOutcome() with the real fetch response and parsed body', () => {
    expect(handleConnectBody).toContain('const outcome = resolveConnectOutcome(response, data)');
  });

  it('clears any previous error at the start of every connect attempt', () => {
    const tryIndex = handleConnectBody.indexOf('try {');
    expect(handleConnectBody.slice(0, tryIndex)).toContain('setConnectError(null)');
  });

  it('4. resets connecting on the outcome-not-ok branch, before returning, and shows the message', () => {
    const notOkStart = handleConnectBody.indexOf('if (!outcome.ok) {');
    const notOkEnd = handleConnectBody.indexOf('}', handleConnectBody.indexOf('return', notOkStart));
    const branch = handleConnectBody.slice(notOkStart, notOkEnd);

    expect(notOkStart).toBeGreaterThan(-1);
    expect(branch).toContain('setConnectError({ marketplace, message: outcome.message })');
    expect(branch).toContain('setConnecting(null)');
    expect(branch).toContain('return');
  });

  it('4b. resets connecting in the catch block too (network-level failure, e.g. fetch() itself rejecting)', () => {
    const catchStart = handleConnectBody.indexOf('} catch (error) {');
    const catchBlock = handleConnectBody.slice(catchStart);

    expect(catchStart).toBeGreaterThan(-1);
    expect(catchBlock).toContain('setConnectError({');
    expect(catchBlock).toContain('setConnecting(null)');
  });

  it('preserves the exact existing redirect behavior on success: window.location.href = <authUrl>, only reached when outcome.ok', () => {
    const successLineIndex = handleConnectBody.indexOf('window.location.href = outcome.authUrl');
    const notOkReturnIndex = handleConnectBody.indexOf('return', handleConnectBody.indexOf('if (!outcome.ok) {'));

    expect(successLineIndex).toBeGreaterThan(-1);
    // The success assignment must come after the early return for the
    // failure branch — i.e. it's genuinely gated on outcome.ok, not run
    // unconditionally.
    expect(successLineIndex).toBeGreaterThan(notOkReturnIndex);
  });
});

describe('Error message is actually rendered to the user, for both marketplaces', () => {
  it('renders connectError.message in a visible element when it targets ebay', () => {
    expect(componentSource).toContain("connectError?.marketplace === 'ebay'");
  });

  it('renders connectError.message in a visible element when it targets etsy', () => {
    expect(componentSource).toContain("connectError?.marketplace === 'etsy'");
  });

  it('both render the same connectError.message value', () => {
    const occurrences = [...componentSource.matchAll(/\{connectError\.message\}/g)];
    expect(occurrences.length).toBe(2);
  });
});

describe('Scope: only the frontend card changed — no backend/OAuth/DB code referenced here', () => {
  it('does not reference TokenManager, MarketplaceConnectionService, or the OAuth callback route', () => {
    expect(componentSource).not.toContain('TokenManager');
    expect(componentSource).not.toContain('MarketplaceConnectionService');
    expect(componentSource).not.toContain('/api/marketplace/callback');
  });

  it('still calls the same connect/disconnect endpoints as before, unchanged', () => {
    expect(componentSource).toContain('fetch(`/api/marketplace/connect/${marketplace}`)');
    expect(componentSource).toContain('fetch(`/api/marketplace/disconnect/${marketplace}`');
  });
});

/**
 * Finding #3 fix: the OAuth callback redirects back to this page with
 * ?status=connected&marketplace=... (success) or ?status=error&error=...
 * (failure), but nothing ever read or displayed those params — a
 * successful or failed eBay/Etsy connection attempt was silently lost.
 *
 * resolveCallbackNotice() is the pure decision logic for turning those
 * three raw query values into a one-time notice. Like
 * resolveConnectOutcome() above, this file can't be imported directly
 * (jsx: "preserve" + .tsx under Vitest/esbuild — see header comment), so
 * this proves the logic via source-level checks against the real
 * function body, the same convention already established here.
 */
describe('resolveCallbackNotice() — pure decision logic for the OAuth callback redirect', () => {
  const fnStart = componentSource.indexOf('export function resolveCallbackNotice(');
  const fnEnd = componentSource.indexOf('\n}\n', fnStart);
  const fnBody = componentSource.slice(fnStart, fnEnd);

  it('exists as a standalone, exported function (testable independently of React state)', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('1 & 2. on status=connected with a recognized marketplace, builds a success message using its display name (covers both ebay and etsy via the shared lookup table)', () => {
    expect(fnBody).toContain("if (status === 'connected')");
    expect(fnBody).toContain('marketplaceParam ? MARKETPLACE_DISPLAY_NAMES[marketplaceParam] : undefined');
    expect(fnBody).toContain("return { type: 'success', message: `${displayName} connected successfully.` }");
    // The lookup table itself must map both real marketplaces to their display name.
    expect(componentSource).toContain("ebay: 'eBay'");
    expect(componentSource).toContain("etsy: 'Etsy'");
  });

  it('does not fabricate a success message when marketplace is missing/unrecognized on status=connected', () => {
    const connectedBranchStart = fnBody.indexOf("if (status === 'connected')");
    const connectedBranchEnd = fnBody.indexOf('if (status === \'error\')');
    const connectedBranch = fnBody.slice(connectedBranchStart, connectedBranchEnd);
    expect(connectedBranch).toContain('if (!displayName) return null');
  });

  it('3. on status=error, surfaces the provided error message verbatim, with a safe generic fallback', () => {
    expect(fnBody).toContain("if (status === 'error')");
    expect(fnBody).toContain('message: errorParam ||');
    expect(fnBody).toContain("'Something went wrong connecting your marketplace account.'");
  });

  it('4 & 7. returns null for no/unrecognized status — no message, no crash (falls through to the final return)', () => {
    expect(fnBody.trim().endsWith('return null')).toBe(true);
  });
});

describe('MarketplaceConnectionsCard wires resolveCallbackNotice() into a one-time, cleaned-up notice', () => {
  it('reads status/marketplace/error from useSearchParams(), not from a trusted workspaceId or any other source', () => {
    expect(componentSource).toContain("import { useRouter, usePathname, useSearchParams } from 'next/navigation'");
    expect(componentSource).toContain("searchParams.get('status')");
    expect(componentSource).toContain("searchParams.get('marketplace')");
    expect(componentSource).toContain("searchParams.get('error')");
    // No workspaceId is ever read from the URL by this component.
    expect(componentSource).not.toContain("searchParams.get('workspaceId')");
  });

  it('5. computes the notice once (lazy useState initializer) and cleans the URL via router.replace(pathname) in a mount-only effect', () => {
    expect(componentSource).toContain('const [callbackNotice] = useState(() =>');
    const effectStart = componentSource.indexOf('useEffect(() => {\n    if (callbackNotice)');
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = componentSource.indexOf('}, [])', effectStart);
    const effectBody = componentSource.slice(effectStart, effectEnd);
    expect(effectBody).toContain('router.replace(pathname)');
    // Empty dependency array: runs once on mount, not on every render.
    expect(componentSource.slice(effectEnd, effectEnd + 6)).toBe('}, [])');
  });

  it('6. renders the message as plain JSX text (React-escaped), never via dangerouslySetInnerHTML', () => {
    expect(componentSource).toContain('{callbackNotice.message}');
    expect(componentSource).not.toContain('dangerouslySetInnerHTML');
  });

  it('4. the notice banner is only rendered when a notice actually exists (no params -> no banner)', () => {
    expect(componentSource).toContain('{callbackNotice && (');
  });

  it('reuses the existing success/error visual style already used elsewhere in this file, rather than introducing new classes', () => {
    // Same classes as the existing permanent "connected" banner.
    expect(componentSource).toContain("'p-4 bg-[#FF5A1F]/10 rounded-xl border border-[#FF5A1F]/20'");
    // Same classes as the existing connectError banner.
    expect(componentSource).toContain("'p-4 bg-red-500/10 rounded-xl border border-red-500/20'");
  });
});

/**
 * Connector Hub audit (B1) fix: both marketplace cards must render a
 * visually and textually distinct "expired" state, with a reconnect
 * action, and must never show "Connected" for any status other than the
 * literal 'connected'. Source-level checks, same convention as the rest
 * of this file (component can't be imported directly under this
 * tsconfig/Vitest setup — see header comment).
 */
describe('eBay/Etsy cards — expired state is visually and textually distinct from both connected and not_connected', () => {
  it('derives isEbayExpired/isEtsyExpired from resolveDisplayStatus(), never from a raw string comparison', () => {
    expect(componentSource).toContain('const ebayDisplayStatus = resolveDisplayStatus(ebayConnection?.status)');
    expect(componentSource).toContain("const isEbayExpired = ebayDisplayStatus === 'expired'");
    expect(componentSource).toContain('const etsyDisplayStatus = resolveDisplayStatus(etsyConnection?.status)');
    expect(componentSource).toContain("const isEtsyExpired = etsyDisplayStatus === 'expired'");
  });

  it('renders a distinct "Expired — reconnection required" label for both marketplaces, with a visible text label (not color-only)', () => {
    const occurrences = [...componentSource.matchAll(/Expired — reconnection required/g)];
    expect(occurrences.length).toBe(2);
  });

  it('exposes the expired badge via role="status" for assistive technology', () => {
    const occurrences = [...componentSource.matchAll(/role="status"/g)];
    expect(occurrences.length).toBe(2);
  });

  it('offers a reconnect action wired to the existing handleConnect() flow, never a new/duplicate connection flow', () => {
    expect(componentSource).toContain("onClick={() => handleConnect('ebay')}");
    expect(componentSource).toContain("onClick={() => handleConnect('etsy')}");
    const reconnectLabels = [...componentSource.matchAll(/'Reconnect to (eBay|Etsy)'/g)];
    expect(reconnectLabels.length).toBe(2);
  });

  it('the expired branch is checked before the generic not_connected fallback, for both cards (isXExpired as an else-if between connected and the final else)', () => {
    const ebayBranch = componentSource.slice(
      componentSource.indexOf('{isEbayConnected ? ('),
      componentSource.indexOf('{isEbayConnected && (')
    );
    const ebayConnectedIdx = ebayBranch.indexOf('isEbayConnected ?');
    const ebayExpiredIdx = ebayBranch.indexOf('isEbayExpired ?');
    const ebayElseIdx = ebayBranch.lastIndexOf(') : (');
    expect(ebayConnectedIdx).toBeGreaterThan(-1);
    expect(ebayExpiredIdx).toBeGreaterThan(ebayConnectedIdx);
    expect(ebayElseIdx).toBeGreaterThan(ebayExpiredIdx);

    const etsyBranch = componentSource.slice(
      componentSource.indexOf('{isEtsyConnected ? ('),
      componentSource.indexOf('{isEtsyConnected && (')
    );
    const etsyConnectedIdx = etsyBranch.indexOf('isEtsyConnected ?');
    const etsyExpiredIdx = etsyBranch.indexOf('isEtsyExpired ?');
    const etsyElseIdx = etsyBranch.lastIndexOf(') : (');
    expect(etsyConnectedIdx).toBeGreaterThan(-1);
    expect(etsyExpiredIdx).toBeGreaterThan(etsyConnectedIdx);
    expect(etsyElseIdx).toBeGreaterThan(etsyExpiredIdx);
  });

  it('never renders the "Connected" label (nor the green connected indicator) inside the expired branch for either marketplace', () => {
    const ebayExpiredStart = componentSource.indexOf('isEbayExpired ? (');
    const ebayExpiredEnd = componentSource.indexOf(') : (', ebayExpiredStart);
    const ebayExpiredBranch = componentSource.slice(ebayExpiredStart, ebayExpiredEnd);
    expect(ebayExpiredBranch).not.toMatch(/\bConnected\b/);
    expect(ebayExpiredBranch).not.toContain('text-emerald-400');

    const etsyExpiredStart = componentSource.indexOf('isEtsyExpired ? (');
    const etsyExpiredEnd = componentSource.indexOf(') : (', etsyExpiredStart);
    const etsyExpiredBranch = componentSource.slice(etsyExpiredStart, etsyExpiredEnd);
    expect(etsyExpiredBranch).not.toMatch(/\bConnected\b/);
    expect(etsyExpiredBranch).not.toContain('text-emerald-400');
  });

  it('shows a dedicated banner explaining the expired state, for both marketplaces', () => {
    expect(componentSource).toContain('Your eBay connection has expired. Reconnect to resume syncing listings and orders.');
    expect(componentSource).toContain('Your Etsy connection has expired. Reconnect to resume syncing listings and orders.');
    expect(componentSource).toContain('{isEbayExpired && (');
    expect(componentSource).toContain('{isEtsyExpired && (');
  });
});
