/**
 * R6 — server-side request forgery guard for fetches of URLs that a third party can influence
 * (image URLs coming from sourcing results / AI drafts, re-hosted or uploaded by the server).
 *
 * What it enforces, on the first URL AND on every redirect hop (redirects are followed manually):
 *   - http / https only, no credentials in the URL, only ports 80 / 443;
 *   - no `localhost`-like, `.local`, `.internal`, single-label host names;
 *   - IP literals (any notation the WHATWG URL parser normalises) must be public;
 *   - the name must resolve, and EVERY resolved address must be public
 *     (loopback, private, link-local incl. cloud metadata 169.254.0.0/16, CGNAT, multicast,
 *     documentation, reserved, IPv6 ULA / link-local / mapped / NAT64 / 6to4 are refused);
 *   - a timeout and a body-size cap.
 *
 * Known limit (documented, not hidden): the address checked here and the address used by fetch()
 * come from two separate resolutions, so a DNS-rebinding attacker with a very short TTL could still
 * win the race. Closing it needs a pinned-address HTTP agent; the check below removes the direct,
 * non-adversarial-DNS cases (literal private IPs, names that point at private ranges, redirects).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

export class UnsafeRemoteUrlError extends Error {
  constructor(public readonly reason: string) {
    super(`Remote URL refused (${reason})`);
    this.name = 'UnsafeRemoteUrlError';
  }
}

export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: HostLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });
const TEST_LOOKUP_KEY = '__ADKSY_SSRF_TEST_LOOKUP__';

/**
 * Tests only: replace the resolver so no real DNS query is ever made. Pass null to restore.
 * Stored on globalThis (tests reset the module registry) and honoured ONLY under Vitest.
 */
export function __setHostLookupForTests(fn: HostLookup | null): void {
  (globalThis as Record<string, unknown>)[TEST_LOOKUP_KEY] = fn ?? undefined;
}

function currentLookup(): HostLookup {
  if (process.env.VITEST) {
    const injected = (globalThis as Record<string, unknown>)[TEST_LOOKUP_KEY];
    if (typeof injected === 'function') return injected as HostLookup;
  }
  return defaultLookup;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
  });
}

function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const v4tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4tail) {
    const n = ipv4ToInt(v4tail[1]);
    text = text.slice(0, -v4tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True when the address is NOT a routable public unicast address (or cannot be understood: fail-closed). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (!net.isIPv6(ip)) return true;
  const g = expandIPv6(ip);
  if (!g) return true;
  const embeddedV4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // ::, ::1, ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible)
    return g.slice(0, 7).every((x) => x === 0) || isPrivateIPv4(embeddedV4);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(embeddedV4); // NAT64
  if (g[0] === 0x2002) return true; // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard
  return false;
}

const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.home.arpa'];

/** Validates one URL (syntax + host + resolved addresses). Throws UnsafeRemoteUrlError; returns the parsed URL. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeRemoteUrlError('malformed');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeRemoteUrlError('scheme');
  if (url.username || url.password) throw new UnsafeRemoteUrlError('credentials');
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnsafeRemoteUrlError('port');

  let host = url.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) throw new UnsafeRemoteUrlError('no-host');

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeRemoteUrlError('private-address');
    return url;
  }
  const bare = host.endsWith('.') ? host.slice(0, -1) : host;
  if (bare === 'localhost' || !bare.includes('.') || BLOCKED_NAME_SUFFIXES.some((s) => bare.endsWith(s))) {
    throw new UnsafeRemoteUrlError('internal-name');
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await currentLookup()(bare);
  } catch {
    throw new UnsafeRemoteUrlError('unresolvable');
  }
  if (!addresses || addresses.length === 0) throw new UnsafeRemoteUrlError('unresolvable');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new UnsafeRemoteUrlError('resolves-to-private-address');
  return url;
}

export interface FetchPublicOptions {
  timeoutMs?: number;
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** GET a public URL: every hop validated, redirects followed manually, bounded by a timeout. */
export async function fetchPublicUrl(raw: string, options: FetchPublicOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, maxRedirects = 3 } = options;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const response = await globalThis.fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'image/*' },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new UnsafeRemoteUrlError('redirect-without-location');
      current = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new UnsafeRemoteUrlError('too-many-redirects');
}

/** Reads a response body but never more than `maxBytes`. Returns null when it is larger. */
export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = response.body?.getReader?.();
  if (!reader) {
    const whole = Buffer.from(await response.arrayBuffer());
    return whole.length > maxBytes ? null : whole;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
