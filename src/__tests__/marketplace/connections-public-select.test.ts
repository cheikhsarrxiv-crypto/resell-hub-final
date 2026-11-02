/**
 * Proves that marketplace connection rows sent to the browser never carry
 * credentials — not even encrypted ones.
 *
 * Two places used to hand whole MarketplaceConnection rows to client code:
 *  - GET /api/marketplace/connections (JSON response), and
 *  - /dashboard/settings/integrations (props of a 'use client' component,
 *    which Next.js serializes into the page payload).
 * Both returned apiKey, apiSecret, encryptedOauthToken,
 * encryptedRefreshToken, accountEmail and tokenExpiresAt. Both now go
 * through marketplaceConnectionPublicSelect, an explicit allowlist.
 *
 * Same convention as oauth-callback-security.test.ts: these files import
 * next/server / @/auth, which do not resolve in this Vitest setup, so the
 * routes are checked at source level and the allowlist itself is tested
 * directly.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { marketplaceConnectionPublicSelect } from '@/lib/marketplaceConnectionPublicSelect';

const SENSITIVE_FIELDS = [
  'apiKey',
  'apiSecret',
  'encryptedOauthToken',
  'encryptedRefreshToken',
  'accountEmail',
  'tokenExpiresAt',
];

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

const routeSource = read('src/app/api/marketplace/connections/route.ts');
const pageSource = read('src/app/dashboard/settings/integrations/page.tsx');
const cardSource = read('src/components/marketplace/MarketplaceConnectionsCard.tsx');

describe('marketplaceConnectionPublicSelect', () => {
  it('selects none of the sensitive fields', () => {
    const keys = Object.keys(marketplaceConnectionPublicSelect);
    for (const field of SENSITIVE_FIELDS) {
      expect(keys).not.toContain(field);
    }
  });

  it('still selects every field the UI reads', () => {
    expect(marketplaceConnectionPublicSelect).toMatchObject({
      id: true,
      marketplaceId: true,
      status: true,
      createdAt: true,
      marketplace: { select: { name: true, displayName: true } },
    });
  });
});

describe('GET /api/marketplace/connections', () => {
  it('uses the public select instead of returning whole rows', () => {
    expect(routeSource).toContain('select: marketplaceConnectionPublicSelect');
    expect(routeSource).not.toMatch(/include:\s*\{\s*marketplace:\s*true/);
  });
});

describe('/dashboard/settings/integrations', () => {
  it('passes only the public select (plus sync start time) to the client card', () => {
    expect(pageSource).toContain('...marketplaceConnectionPublicSelect');
    expect(pageSource).toContain('select: { startedAt: true }');
    expect(pageSource).not.toMatch(/include:\s*\{\s*marketplace:\s*true/);
  });

  it('card reads SyncLog.startedAt (SyncLog has no createdAt column)', () => {
    expect(cardSource).not.toMatch(/[lL]astSync\.createdAt/);
    expect(cardSource).toContain('lastSync.startedAt');
    expect(cardSource).toContain('etsyLastSync.startedAt');
  });
});
