/**
 * R6 — unit tests never perform a real DNS query. The SSRF guard resolves host names before any
 * fetch; here every name resolves to a documentation-free public address (93.184.216.34) unless a
 * test installs its own resolver with __setHostLookupForTests.
 */
import { beforeEach } from 'vitest';
import { __setHostLookupForTests } from '@/lib/security/ssrfGuard';

beforeEach(() => {
  __setHostLookupForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
});
