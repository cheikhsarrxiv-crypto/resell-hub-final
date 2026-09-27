/**
 * Multi-marketplace auth architecture (Option B) — source-level checks
 * for POST /api/marketplace/connect-manual/[marketplace].
 *
 * This route imports next/server (via NextRequest/NextResponse) and
 * @/auth (which pulls in next-auth), which fails to resolve when
 * imported directly in this Vitest setup — the same pre-existing
 * environment issue documented in oauth-callback-security.test.ts and
 * agent-route-security.test.ts. Matching that established convention,
 * this checks the route is wired correctly at the source level; the real
 * behavioral logic it delegates to (MarketplaceConnectionService.
 * connectWithManualCredentials) is covered behaviorally in
 * MarketplaceConnectionService.test.ts.
 *
 * Also proves the existing OAuth callback route was NOT modified to
 * accept Vinted — the two paths must never overlap.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/marketplace/connect-manual/[marketplace]/route.ts'),
  'utf-8'
);

const callbackSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/marketplace/callback/[marketplace]/route.ts'),
  'utf-8'
);

const connectSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/marketplace/connect/[marketplace]/route.ts'),
  'utf-8'
);

describe('connect-manual/route.ts — auth and workspace isolation', () => {
  it('checks session.user.id before anything else', () => {
    const authIndex = routeSource.indexOf('await auth()');
    const unauthorizedIndex = routeSource.indexOf('status: 401');
    expect(authIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  });

  it('never falls back to a fabricated default workspace', () => {
    expect(routeSource).not.toContain("|| 'default'");
    expect(routeSource).toContain('if (!session.user.workspaceId)');
  });

  it('uses verifyWorkspaceAccess(), never trusts the raw session workspaceId', () => {
    expect(routeSource).toContain("from '@/lib/security'");
    expect(routeSource).toContain('const workspaceId = await verifyWorkspaceAccess(');
  });
});

describe('connect-manual/route.ts — only manual-credential marketplaces are accepted', () => {
  it('rejects a marketplace not in its own allowlist', () => {
    expect(routeSource).toContain('if (!marketplace ||');
  });

  it('cross-checks against getMarketplaceAuthType(), never trusting the allowlist alone', () => {
    expect(routeSource).toContain("getMarketplaceAuthType(marketplace) !== 'manual_credentials'");
  });

  it("its own allowlist contains Vinted but never eBay/Etsy/Depop", () => {
    expect(routeSource).toContain('VINTED: Marketplace.VINTED');
    expect(routeSource).not.toContain('EBAY: Marketplace.EBAY');
    expect(routeSource).not.toContain('ETSY: Marketplace.ETSY');
    expect(routeSource).not.toContain('DEPOP: Marketplace.DEPOP');
  });
});

describe('connect-manual/route.ts — request validation and safe responses', () => {
  it('validates the body with connectManualCredentialsSchema before calling the service', () => {
    const schemaIndex = routeSource.indexOf('connectManualCredentialsSchema.safeParse(body)');
    const serviceCallIndex = routeSource.indexOf('connectWithManualCredentials(');
    expect(schemaIndex).toBeGreaterThan(-1);
    expect(serviceCallIndex).toBeGreaterThan(schemaIndex);
  });

  it('delegates to the central MarketplaceConnectionService, never reimplements the logic here', () => {
    expect(routeSource).toContain('new MarketplaceConnectionService(');
    expect(routeSource).toContain('service.connectWithManualCredentials(workspaceId, marketplace, result.data.credentials)');
  });

  it('never logs the request body or credentials — only a static, generic message (never interpolates a variable)', () => {
    const consoleCalls = [...routeSource.matchAll(/console\.\w+\([^)]*\)/g)].map((m) => m[0]);
    expect(consoleCalls.length).toBeGreaterThan(0);
    for (const call of consoleCalls) {
      // A log line is allowed to use the word "credentials" descriptively
      // (e.g. "...with manual credentials") — what must never happen is
      // interpolating the actual variables that hold secret values.
      expect(call).not.toMatch(/\$\{.*credentials.*\}/i);
      expect(call).not.toContain('result.data');
      expect(call).not.toContain('body)');
      expect(call).not.toMatch(/,\s*body\s*[,)]/);
    }
  });

  it('the success response contains only status and marketplace, never the stored connection or credentials', () => {
    const returnIndex = routeSource.indexOf("status: 'connected'");
    expect(returnIndex).toBeGreaterThan(-1);
    const returnBlock = routeSource.slice(returnIndex, routeSource.indexOf('})', returnIndex));
    expect(returnBlock).not.toContain('credentials');
    expect(returnBlock).not.toContain('encrypted');
  });
});

describe('Vinted never reaches the OAuth callback route', () => {
  it('the OAuth callback route\'s SUPPORTED_MARKETPLACES still excludes Vinted', () => {
    expect(callbackSource).toContain('EBAY: Marketplace.EBAY');
    expect(callbackSource).toContain('ETSY: Marketplace.ETSY');
    expect(callbackSource).not.toContain('VINTED: Marketplace.VINTED');
  });

  it('the OAuth connect route\'s SUPPORTED_MARKETPLACES still excludes Vinted', () => {
    expect(connectSource).toContain('EBAY: Marketplace.EBAY');
    expect(connectSource).toContain('ETSY: Marketplace.ETSY');
    expect(connectSource).not.toContain('VINTED: Marketplace.VINTED');
  });

  it('the OAuth callback route file was not modified to reference connect-manual or manual credentials', () => {
    expect(callbackSource).not.toContain('connect-manual');
    expect(callbackSource).not.toContain('ManualCredential');
    expect(callbackSource).not.toContain('connectWithManualCredentials');
  });
});
