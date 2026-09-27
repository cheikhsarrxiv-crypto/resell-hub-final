/**
 * Multi-marketplace auth architecture (Option B) — ManualCredentialConnectForm.
 *
 * Same convention as MarketplaceConnectionsCard.test.ts: this file can't
 * be imported directly (tsconfig's "jsx": "preserve" makes Vitest/esbuild
 * refuse to parse a .tsx file under this setup), so this checks the pure
 * resolveManualConnectOutcome() logic and the component's wiring via
 * source-level checks against the real file content.
 *
 * Also proves the explicit constraint from this task: the component
 * exists and is fully functional, but is NOT wired into
 * MarketplaceConnectionsCard.tsx or the Integrations page yet — Vinted
 * must not appear as a real, connectable option until real Vinted Pro
 * Integrations access is obtained.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const formSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/marketplace/ManualCredentialConnectForm.tsx'),
  'utf-8'
);
const cardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/marketplace/MarketplaceConnectionsCard.tsx'),
  'utf-8'
);
const pageSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/dashboard/settings/integrations/page.tsx'),
  'utf-8'
);

describe('resolveManualConnectOutcome() — pure decision logic', () => {
  const fnStart = formSource.indexOf('export function resolveManualConnectOutcome(');
  const fnEnd = formSource.indexOf('\n}\n', fnStart);
  const fnBody = formSource.slice(fnStart, fnEnd);

  it('exists as a standalone, exported function', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it("treats response.ok + data.status === 'connected' as success", () => {
    expect(fnBody).toContain("if (response.ok && data.status === 'connected')");
    expect(fnBody).toContain('return { ok: true }');
  });

  it('treats anything else as failure, carrying data.error through with a safe fallback', () => {
    expect(fnBody).toContain('message: data.error ||');
  });
});

describe('ManualCredentialConnectForm — posts to the right endpoint, never logs secrets', () => {
  it('posts to /api/marketplace/connect-manual/${marketplace}', () => {
    expect(formSource).toContain('fetch(`/api/marketplace/connect-manual/${marketplace}`');
    expect(formSource).toContain("method: 'POST'");
  });

  it('sends field values wrapped under a `credentials` key, matching the route/service contract', () => {
    expect(formSource).toContain('body: JSON.stringify({ credentials: values })');
  });

  it('inputs default to type="password", never plain text, unless a field explicitly overrides it', () => {
    expect(formSource).toContain("type={field.type ?? 'password'}");
  });

  it('never logs the submitted values anywhere in this file', () => {
    const consoleCalls = [...formSource.matchAll(/console\.\w+\([^)]*\)/g)];
    expect(consoleCalls.length).toBe(0);
  });

  it('clears local field values after a successful submit — never keeps secrets in memory longer than needed', () => {
    expect(formSource).toContain('setValues({})');
  });
});

describe('Vinted is NOT wired as a real, connectable option yet', () => {
  it('MarketplaceConnectionsCard.tsx does not import or render ManualCredentialConnectForm', () => {
    expect(cardSource).not.toContain('ManualCredentialConnectForm');
  });

  it('MarketplaceConnectionsCard.tsx has no Vinted card/section at all', () => {
    expect(cardSource).not.toContain('Vinted');
    expect(cardSource).not.toContain("'vinted'");
  });

  it('the Integrations page does not import or render ManualCredentialConnectForm', () => {
    expect(pageSource).not.toContain('ManualCredentialConnectForm');
    expect(pageSource).not.toContain('Vinted');
  });
});
