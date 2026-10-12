/**
 * SSRF-hardening tests for src/services/ssrfSafeFetch.ts — the transport
 * StorageService.rehostImageFromUrl now uses instead of a bare fetch().
 *
 * No real network call is ever made: `https`/`dns` are mocked at the
 * module boundary. Where a check happens before any I/O (protocol, a
 * literal private IP), the mocks additionally assert they were never
 * even reached — proving the rejection is synchronous/pre-connect, not
 * just eventually correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const dnsLookupMock = vi.fn();
const httpsRequestMock = vi.fn();

vi.mock('dns', () => ({
  default: { lookup: (...args: unknown[]) => dnsLookupMock(...args) },
  lookup: (...args: unknown[]) => dnsLookupMock(...args),
}));

vi.mock('https', () => ({
  default: { request: (...args: unknown[]) => httpsRequestMock(...args) },
  request: (...args: unknown[]) => httpsRequestMock(...args),
}));

/** A minimal fake of the http.ClientRequest/IncomingMessage pair fetchSafely drives. */
class FakeReq extends EventEmitter {
  // Real Node ClientRequest.destroy(err) emits 'error' with that err — see
  // https://nodejs.org/api/http.html#requestdestroyerror. Mirrored here so
  // fetchSafely's req.destroy(new Error(...)) (its timeout handler) behaves
  // the same way under this mock as it does against the real http module.
  destroy = vi.fn((err?: Error) => {
    if (err) setImmediate(() => this.emit('error', err));
  });
  end = vi.fn();
}
class FakeRes extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  resume = vi.fn();
  destroy = vi.fn();
  constructor(statusCode: number, headers: Record<string, string> = {}, statusMessage = '') {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
    this.statusMessage = statusMessage;
  }
}

/**
 * Wires httpsRequestMock to hand back `req` and invoke the request
 * callback with `res` SYNCHRONOUSLY, inside the same call — fetchSafely
 * itself awaits a DNS lookup before ever calling https.request, so by
 * the time this mock implementation runs, fetchSafely is resuming from
 * its own internal await; deferring further via queueMicrotask here would
 * race against that resumption's own pending microtask (and did, before
 * this fix — see the fixed commit's test-run history). Calling the
 * callback synchronously, nested in the same synchronous frame
 * https.request() is invoked from, removes the race entirely: res's
 * listeners are attached before this function (and fetchSafely's
 * resumption) returns control to the test.
 */
function mockOneExchange(res: FakeRes): FakeReq {
  const req = new FakeReq();
  httpsRequestMock.mockImplementationOnce((_options: unknown, callback: (res: FakeRes) => void) => {
    callback(res);
    return req;
  });
  return req;
}

/**
 * Emits after letting every currently-pending microtask (including
 * fetchSafely's own internal await chain) drain first — setImmediate
 * callbacks run in the next event-loop phase, strictly after the
 * microtask queue, so this is safe regardless of how many internal
 * awaits fetchSafely has already resumed through by the time this runs.
 */
function emitBodyThenEnd(res: FakeRes, chunks: Buffer[]) {
  setImmediate(() => {
    for (const chunk of chunks) res.emit('data', chunk);
    res.emit('end');
  });
}

beforeEach(() => {
  dnsLookupMock.mockReset();
  httpsRequestMock.mockReset();
});

describe('isPrivateOrReservedIp', () => {
  it.each([
    ['127.0.0.1', true, 'IPv4 loopback'],
    ['10.0.0.5', true, '10.0.0.0/8 private'],
    ['172.16.5.1', true, '172.16.0.0/12 private'],
    ['192.168.1.1', true, '192.168.0.0/16 private'],
    ['169.254.169.254', true, 'link-local / cloud metadata'],
    ['169.254.0.1', true, 'link-local'],
    ['100.64.0.1', true, 'CGNAT shared address space'],
    ['0.0.0.0', true, 'unspecified'],
    ['224.0.0.1', true, 'multicast'],
    ['255.255.255.255', true, 'broadcast'],
    ['192.0.2.1', true, 'TEST-NET-1 documentation range'],
    ['8.8.8.8', false, 'public (Google DNS)'],
    ['1.1.1.1', false, 'public (Cloudflare)'],
    ['93.184.216.34', false, 'public (example.com)'],
    ['::1', true, 'IPv6 loopback'],
    ['fe80::1', true, 'IPv6 link-local'],
    ['fc00::1', true, 'IPv6 unique-local (fc00::/7)'],
    ['fd12:3456::1', true, 'IPv6 unique-local (fd00::/8)'],
    // fec0::/10 — deprecated (RFC 3879) site-local, previously NOT
    // blocked. Covers its lower bound, an interior address, and its
    // upper bound exactly.
    ['fec0::', true, 'IPv6 site-local fec0::/10, lower bound (regression)'],
    ['fec0::1', true, 'IPv6 site-local fec0::/10 (regression)'],
    ['fed5::abcd', true, 'IPv6 site-local fec0::/10, interior address (regression)'],
    ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true, 'IPv6 site-local fec0::/10, upper bound (regression)'],
    // Must NOT be widened beyond fe80::/10 + fec0::/10: the address just
    // below fe80::/10's lower bound stays unaffected by this fix.
    ['fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false, 'just below fe80::/10 — must remain unaffected'],
    ['2001:4860:4860::8888', false, 'public IPv6 (Google public DNS) — must remain accepted'],
    ['::ffff:127.0.0.1', true, 'IPv4-mapped loopback, dotted-decimal form'],
    ['::ffff:10.0.0.1', true, 'IPv4-mapped private, dotted-decimal form'],
    // Regression: the hex-compressed form of ::ffff:127.0.0.1 — same
    // address, previously NOT recognized because only the dotted-decimal
    // textual form was checked.
    ['::ffff:7f00:1', true, 'IPv4-mapped loopback, hex-compressed form (regression)'],
    ['0000:0000:0000:0000:0000:ffff:7f00:0001', true, 'IPv4-mapped loopback, fully expanded hex form'],
    // 93.184.216.34 (example.com, public) mapped into IPv6 — must NOT be
    // blocked just because it's expressed as an IPv6 literal.
    ['::ffff:5db8:d822', false, 'public IPv4 address mapped into IPv6, hex form'],
    ['::ffff:93.184.216.34', false, 'public IPv4 address mapped into IPv6, dotted-decimal form'],
    ['2606:4700:4700::1111', false, 'public IPv6 (Cloudflare)'],
    ['not-an-ip', true, 'malformed input treated as unsafe'],
  ])('%s -> private/reserved=%s (%s)', async (ip, expected) => {
    const { isPrivateOrReservedIp } = await import('@/services/ssrfSafeFetch');
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('fetchSafely — rejected before any network I/O', () => {
  it('rejects a non-https URL without ever touching dns or https', async () => {
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');
    await expect(fetchSafely('http://example.com/img.png', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /non-https/i
    );
    expect(dnsLookupMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a literal private IPv4 URL without a DNS lookup or any request', async () => {
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');
    await expect(fetchSafely('https://127.0.0.1/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /private\/reserved/i
    );
    expect(dnsLookupMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects the literal cloud metadata address (169.254.169.254)', async () => {
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');
    await expect(
      fetchSafely('https://169.254.169.254/latest/meta-data/', { maxBytes: 1000, timeoutMs: 1000 })
    ).rejects.toThrow(/private\/reserved/i);
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a bracketed IPv6 loopback host (https://[::1]/...) without a DNS lookup or any request', async () => {
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');
    await expect(fetchSafely('https://[::1]/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /private\/reserved/i
    );
    expect(dnsLookupMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});

describe('fetchSafely — DNS-based rejection (hostname resolves to a private address)', () => {
  it('rejects when the hostname resolves to a private IP, never issuing the request', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '10.1.2.3', family: 4 }]));
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    await expect(fetchSafely('https://evil.example.com/img.png', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /resolves to a private\/reserved address/i
    );
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});

describe('fetchSafely — successful download', () => {
  it('resolves with the downloaded bytes and content-type for a public host', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const res = new FakeRes(200, { 'content-type': 'image/png' });
    mockOneExchange(res);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/img.png', { maxBytes: 1000, timeoutMs: 1000 });
    emitBodyThenEnd(res, [Buffer.from([1, 2, 3, 4])]);

    const result = await promise;
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(result.contentType).toBe('image/png');
  });

  it('pins the connection to the exact DNS-validated address via the lookup option', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const res = new FakeRes(200, { 'content-type': 'image/png' });
    mockOneExchange(res);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/img.png', { maxBytes: 1000, timeoutMs: 1000 });
    emitBodyThenEnd(res, [Buffer.from([1])]);
    await promise;

    const requestOptions = httpsRequestMock.mock.calls[0][0];
    expect(typeof requestOptions.lookup).toBe('function');
    const lookupCallback = vi.fn();
    requestOptions.lookup('example.com', {}, lookupCallback);
    expect(lookupCallback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });
});

describe('fetchSafely — redirects', () => {
  it('follows a redirect to a safe public host, re-validating it from scratch', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const redirectRes = new FakeRes(302, { location: 'https://cdn.example.com/final.png' });
    mockOneExchange(redirectRes);
    const finalRes = new FakeRes(200, { 'content-type': 'image/png' });
    mockOneExchange(finalRes);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/redirector', { maxBytes: 1000, timeoutMs: 1000 });
    await Promise.resolve(); // let the redirect hop's microtask-queued callback fire
    emitBodyThenEnd(finalRes, [Buffer.from([9, 9])]);

    const result = await promise;
    expect(result.buffer).toEqual(Buffer.from([9, 9]));
    expect(result.finalUrl).toBe('https://cdn.example.com/final.png');
    expect(httpsRequestMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect whose target resolves to a private address', async () => {
    dnsLookupMock.mockImplementationOnce((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    dnsLookupMock.mockImplementationOnce((_hostname, _opts, cb) => cb(null, [{ address: '169.254.169.254', family: 4 }]));
    const redirectRes = new FakeRes(302, { location: 'https://internal.example.com/secret' });
    mockOneExchange(redirectRes);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    await expect(fetchSafely('https://example.com/redirector', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /private\/reserved/i
    );
    expect(httpsRequestMock).toHaveBeenCalledTimes(1); // never actually requested the redirect target
  });

  it('rejects a redirect to a literal, bracketed private IPv6 address, without a second request', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const redirectRes = new FakeRes(302, { location: 'https://[fe80::1]/secret' });
    mockOneExchange(redirectRes);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    await expect(fetchSafely('https://example.com/redirector', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /private\/reserved/i
    );
    expect(httpsRequestMock).toHaveBeenCalledTimes(1); // never actually requested the redirect target
  });

  it('rejects after exceeding the redirect limit', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    for (let i = 0; i < 5; i++) {
      const res = new FakeRes(302, { location: `https://example.com/hop-${i}` });
      mockOneExchange(res);
    }
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    await expect(
      fetchSafely('https://example.com/start', { maxBytes: 1000, timeoutMs: 1000, maxRedirects: 3 })
    ).rejects.toThrow(/too many redirects/i);
  });
});

describe('fetchSafely — streaming size limit', () => {
  it('destroys the connection and rejects once the byte cap is exceeded, mid-stream', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const res = new FakeRes(200, { 'content-type': 'image/png' });
    const req = mockOneExchange(res);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/huge.png', { maxBytes: 10, timeoutMs: 1000 });
    setImmediate(() => {
      res.emit('data', Buffer.alloc(6));
      res.emit('data', Buffer.alloc(6)); // total 12 > maxBytes 10
    });

    await expect(promise).rejects.toThrow(/too large/i);
    expect(res.destroy).toHaveBeenCalled();
    expect(req.destroy).toHaveBeenCalled();
  });
});

describe('fetchSafely — timeout and network errors', () => {
  it('rejects when the request times out', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const req = new FakeReq();
    httpsRequestMock.mockImplementationOnce(() => req);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/slow.png', { maxBytes: 1000, timeoutMs: 50 });
    setImmediate(() => req.emit('timeout'));

    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it('rejects on a network error from the request', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const req = new FakeReq();
    httpsRequestMock.mockImplementationOnce(() => req);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/img.png', { maxBytes: 1000, timeoutMs: 1000 });
    setImmediate(() => req.emit('error', new Error('ECONNRESET')));

    await expect(promise).rejects.toThrow(/ECONNRESET/);
  });

  it('rejects when the host cannot be resolved at all', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(new Error('ENOTFOUND'), undefined));
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    await expect(fetchSafely('https://does-not-exist.example/img.png', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /ENOTFOUND/
    );
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a non-2xx, non-redirect response', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const res = new FakeRes(404, {}, 'Not Found');
    mockOneExchange(res);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    await expect(fetchSafely('https://example.com/gone.png', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow(
      /404/
    );
  });

  /**
   * Documented residual gap (see this file's header, point 4 of the
   * security review): there is no dedicated res.on('close')/('aborted')
   * handler, so a connection that drops mid-stream WITHOUT emitting an
   * explicit 'error' never resolves or rejects on its own — only the
   * overall request timeout eventually catches it. This test proves
   * that safety net actually works, not that the gap is closed.
   */
  it('a response that closes prematurely with no "end" and no "error" is still eventually caught by the timeout', async () => {
    dnsLookupMock.mockImplementation((_hostname, _opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]));
    const res = new FakeRes(200, { 'content-type': 'image/png' });
    const req = mockOneExchange(res);
    const { fetchSafely } = await import('@/services/ssrfSafeFetch');

    const promise = fetchSafely('https://example.com/interrupted.png', { maxBytes: 1000, timeoutMs: 50 });
    setImmediate(() => {
      res.emit('data', Buffer.from([1, 2])); // partial body
      res.emit('close'); // connection drops: no 'end', no 'error' — silently ignored today
      setImmediate(() => req.emit('timeout')); // the only thing that currently catches this
    });

    await expect(promise).rejects.toThrow(/timed out/i);
  });
});
