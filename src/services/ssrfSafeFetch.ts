/**
 * SSRF-safe HTTPS fetch for downloading a remote image by URL before
 * re-hosting it (see StorageService.rehostImageFromUrl, its only caller).
 * The URL comes from a third party (an image-generation provider's API
 * response today) — this module does not assume that source is trustworthy
 * forever, and defends the fetch itself rather than relying on who calls it.
 *
 * What this actually guarantees (real Node.js API contracts, not guesses):
 *   - https: only. http:/file:/ftp:/data: and everything else is rejected
 *     before any network activity.
 *   - The hostname is resolved via dns.lookup and every resolved address is
 *     checked against a best-effort list of private/reserved/loopback/
 *     link-local ranges (including the 169.254.169.254 cloud metadata
 *     address, which falls under link-local) BEFORE connecting.
 *   - The TCP connection for that request is pinned to the exact address
 *     just validated, via the `lookup` option Node's https.request/
 *     net.connect accept: Node calls this function, in place of its own
 *     DNS resolution, to get the address it actually connects to. Returning
 *     only the pre-validated address here closes the TOCTOU/DNS-rebinding
 *     gap between "we checked this hostname's address" and "the socket
 *     connects" — this is a documented Node.js API behavior, not an
 *     assumption about DNS caching.
 *   - Redirects are never auto-followed (Node's http/https module never
 *     does this on its own). A 3xx response is handled explicitly here by
 *     re-running this entire function — protocol check, DNS lookup, IP
 *     validation, pinning — on the Location target, up to a fixed hop
 *     limit.
 *   - The response body is read in a streaming loop with a running byte
 *     count; the socket is destroyed the moment the limit is exceeded,
 *     never after buffering the whole (potentially huge) body first.
 *   - An explicit timeout aborts the request if it runs too long.
 *
 * What this does NOT guarantee (documented honestly, not papered over):
 *   - The private/reserved IP range list below is a best-effort set of the
 *     well-known ranges (RFC 1918, loopback, link-local/metadata, CGNAT,
 *     multicast, the IPv6 equivalents, etc.) — it is not a formally
 *     verified, exhaustive implementation of every IANA special-purpose
 *     registry entry, and it does not attempt to parse exotic/legacy IPv4
 *     literal encodings (octal, hex, decimal-integer forms like
 *     `http://2130706433/`) that `new URL()`/`net.isIP()` themselves don't
 *     normalize — those are rejected only if `net.isIP` already refuses to
 *     recognize them as literals, not specifically detected as an
 *     obfuscated-IP bypass attempt.
 *   - IPv4-mapped IPv6 addresses ARE fully normalized before the
 *     private/reserved check — expandIPv6() below expands any valid
 *     textual IPv6 form (including :: compression and a trailing embedded
 *     IPv4 dotted-quad) to 8 canonical hex groups first, so the
 *     hex-compressed form (`::ffff:7f00:1`) and the dotted-decimal form
 *     (`::ffff:127.0.0.1`) of the exact same address are recognized
 *     identically. A bracketed IPv6 host in a URL (`[::1]`) is also
 *     stripped to its bare address before any check, so it is never
 *     mistaken for an ordinary hostname.
 *   - DNS pinning protects the one connection this function makes for a
 *     given hop. It cannot detect an attacker who serves genuinely
 *     different, legitimate-looking content through a public IP that
 *     later turns out to be internally routable in this specific hosting
 *     environment's network topology (i.e. this is DNS-rebinding
 *     resistance, not a network-layer firewall) — a real guarantee against
 *     that class of risk would need an egress firewall/proxy allowlist at
 *     the infrastructure layer, outside what application code can verify.
 */
import https from 'https';
import dns from 'dns';
import net from 'net';

export const ALLOWED_PROTOCOL = 'https:';

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed -> treat as unsafe
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. 169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 shared/CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255 broadcast
  return false;
}

/**
 * Expands any valid textual IPv6 address — including "::" compression
 * and a trailing embedded IPv4 dotted-quad (valid syntax for the last 32
 * bits, e.g. "::ffff:127.0.0.1") — into 8 lowercase, zero-padded 16-bit
 * hex groups. This is what lets isPrivateOrReservedIPv6 below treat
 * "::ffff:127.0.0.1" and "::ffff:7f00:1" as the identical address they
 * are: both normalize to the same 8 groups here, regardless of which
 * notation the caller (or an attacker) used. Returns null for anything
 * that doesn't parse as a valid IPv6 literal.
 */
function expandIPv6(address: string): string[] | null {
  let addr = address.toLowerCase();
  const percentIdx = addr.indexOf('%'); // strip a zone id, e.g. "fe80::1%eth0"
  if (percentIdx !== -1) addr = addr.slice(0, percentIdx);

  // An embedded IPv4 dotted-quad is only ever valid in the last group
  // position. Convert it to two hex groups up front so every later step
  // only ever has to deal with plain hex groups.
  const ipv4Tail = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4Tail) {
    const octets = ipv4Tail[1].split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    const hex1 = (((octets[0] << 8) | octets[1]) & 0xffff).toString(16);
    const hex2 = (((octets[2] << 8) | octets[3]) & 0xffff).toString(16);
    addr = addr.slice(0, addr.length - ipv4Tail[1].length) + hex1 + ':' + hex2;
  }

  if (addr.includes(':::')) return null; // never valid
  const doubleColonCount = addr.split('::').length - 1;
  if (doubleColonCount > 1) return null; // at most one "::" compression

  let groups: string[];
  if (doubleColonCount === 1) {
    const [left, right] = addr.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - (leftGroups.length + rightGroups.length);
    if (missing < 0) return null;
    groups = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    groups = addr.split(':');
  }

  if (groups.length !== 8) return null;
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (!groups) return true; // not a valid IPv6 literal -> never treat as safe

  const isAllZero = (gs: string[]) => gs.every((g) => g === '0000');

  if (isAllZero(groups)) return true; // :: unspecified
  if (isAllZero(groups.slice(0, 7)) && groups[7] === '0001') return true; // ::1 loopback

  // fe80::/10 link-local (fe80-febf) and fec0::/10 site-local — deprecated
  // by RFC 3879 since 2004, but still a reserved, never-publicly-routable
  // range, so still blocked (fec0-feff). The two ranges are adjacent and
  // together span the full fe80-feff; nothing below fe80 or above feff
  // matches this pattern, so this does not widen the check to any
  // address outside those two specific ranges.
  if (/^fe[89a-f]/.test(groups[0])) return true;
  if (/^f[cd]/.test(groups[0])) return true; // fc00::/7 unique local
  if (groups[0] === '2001' && groups[1] === '0db8') return true; // documentation range

  // IPv4-mapped ::ffff:0:0/96 — groups 0-4 all zero, group 5 is ffff.
  // Re-check the embedded IPv4 address against the IPv4 rules above,
  // regardless of whether it was originally written in dotted-decimal or
  // hex-compressed form — expandIPv6 already normalized both to the same
  // two hex groups here.
  if (isAllZero(groups.slice(0, 5)) && groups[5] === 'ffff') {
    const g6 = parseInt(groups[6], 16);
    const g7 = parseInt(groups[7], 16);
    const embeddedIPv4 = [(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff].join('.');
    return isPrivateOrReservedIPv4(embeddedIPv4);
  }

  return false;
}

/**
 * Strips the surrounding [] from a bracketed IPv6 literal host, exactly
 * as it appears in a URL's own `hostname` (new URL(...).hostname keeps
 * the brackets — see https://url.spec.whatwg.org/#dom-url-hostname).
 * Without this, a literal IPv6 host like "[::1]" would fail net.isIP's
 * literal check (it doesn't accept brackets) and fall through to being
 * treated as an ordinary DNS hostname instead of the loopback address it
 * actually is. A no-op for a normal domain name, which never has
 * brackets.
 */
function stripIPv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/** Best-effort check — see this file's header for exactly what it does and does not cover. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateOrReservedIPv4(ip);
  if (family === 6) return isPrivateOrReservedIPv6(ip);
  return true; // not a recognized IP literal at all -> never treat as safe
}

export interface SafeFetchOptions {
  /** Hard cap on response body size, enforced while streaming (never after full buffering). */
  maxBytes: number;
  /** Aborts the request (and any pending redirect hop) if exceeded. */
  timeoutMs: number;
  /** Defaults to 3. Each hop re-runs every check in this file from scratch. */
  maxRedirects?: number;
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
}

function lookupPromise(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/**
 * Resolves `hostname` and rejects if the literal is, or resolves to, any
 * private/reserved/loopback/link-local address. Returns the validated
 * addresses so the caller can pin the real connection to one of them.
 */
async function resolveAndValidateHost(rawHostname: string): Promise<Array<{ address: string; family: number }>> {
  // A URL's own .hostname keeps [] around an IPv6 literal (e.g. "[::1]") —
  // strip it first, or net.isIP would refuse to recognize it as a
  // literal at all and this would wrongly fall through to a DNS lookup
  // of the literal string "[::1]" as if it were an ordinary hostname.
  const hostname = stripIPv6Brackets(rawHostname);
  const literalFamily = net.isIP(hostname);
  if (literalFamily !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error(`Refusing to fetch from a private/reserved address: ${hostname}`);
    }
    return [{ address: hostname, family: literalFamily }];
  }

  const addresses = await lookupPromise(hostname);
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(`Refusing to fetch "${hostname}": it resolves to a private/reserved address.`);
    }
  }
  return addresses;
}

/**
 * Downloads `initialUrl` with the SSRF defenses described at the top of
 * this file. Never auto-follows a redirect without re-validating its
 * target from scratch.
 */
export async function fetchSafely(initialUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  let currentUrl = initialUrl;

  for (let hop = 0; ; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== ALLOWED_PROTOCOL) {
      throw new Error(`Refusing to fetch a non-https URL (protocol was "${parsed.protocol}")`);
    }

    const requestHostname = stripIPv6Brackets(parsed.hostname);
    const validatedAddresses = await resolveAndValidateHost(parsed.hostname);
    const pinnedAddress = validatedAddresses[0];
    // Pins the real TCP connection to the exact address already validated
    // above — see this file's header comment for exactly what this does
    // and does not guarantee.
    const pinnedLookup: typeof dns.lookup = ((_hostname: string, cbOrOptions: any, maybeCb?: any) => {
      const callback = typeof cbOrOptions === 'function' ? cbOrOptions : maybeCb;
      callback(null, pinnedAddress.address, pinnedAddress.family);
    }) as typeof dns.lookup;

    const result = await new Promise<{ redirectTo: string } | SafeFetchResult>((resolve, reject) => {
      const req = https.request(
        {
          hostname: requestHostname,
          port: parsed.port || 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          lookup: pinnedLookup,
          timeout: options.timeoutMs,
          headers: { 'User-Agent': 'ADKSY-image-fetch/1.0' },
        },
        (res) => {
          const status = res.statusCode ?? 0;

          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = res.headers.location;
            res.resume(); // discard body, release the socket
            if (!location) {
              reject(new Error(`Redirect response (${status}) had no Location header`));
              return;
            }
            resolve({ redirectTo: new URL(location, currentUrl).toString() });
            return;
          }

          if (status < 200 || status >= 300) {
            res.resume();
            reject(new Error(`Failed to download image: ${status} ${res.statusMessage ?? ''}`.trim()));
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          let destroyed = false;

          res.on('data', (chunk: Buffer) => {
            if (destroyed) return;
            total += chunk.length;
            if (total > options.maxBytes) {
              destroyed = true;
              res.destroy();
              req.destroy();
              reject(new Error(`File too large. Maximum size: ${options.maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (destroyed) return;
            resolve({
              buffer: Buffer.concat(chunks),
              contentType: res.headers['content-type'] ?? null,
              finalUrl: currentUrl,
            });
          });

          res.on('error', (err) => {
            if (!destroyed) reject(err);
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
      });
      req.on('error', (err) => reject(err));
      req.end();
    });

    if ('redirectTo' in result) {
      if (hop + 1 >= maxRedirects) {
        throw new Error(`Too many redirects (limit: ${maxRedirects})`);
      }
      currentUrl = result.redirectTo;
      continue;
    }

    return result;
  }
}
