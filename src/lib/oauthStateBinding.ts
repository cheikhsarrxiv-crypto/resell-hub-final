/**
 * B.11.1 — OAuth state bound to the workspace (and user) that started the flow.
 *
 * Before: the callback compared the `state` of the query string with an httpOnly cookie, then attached the
 * connection to the workspace of the session AT CALLBACK TIME. If the session (user or workspace) changed
 * between "connect" and "callback" in the same browser, the connection was attributed to a workspace that
 * never started the flow.
 *
 * Now the cookie no longer holds the bare state: it holds `v1.<state>.<issuedAt>.<mac>` where
 *   mac = HMAC-SHA256(derivedKey, marketplace | state | workspaceId | userId | issuedAt)
 * computed at "connect" from the VERIFIED session workspace/user. At the callback the MAC is recomputed from the
 * CURRENT verified session; any difference (other workspace, other user, other marketplace, altered state or
 * time) rejects the callback. Neither the workspace id nor the user id is stored in the cookie or the URL.
 * No database table and no migration are needed: the browser-bound cookie is already the state store.
 *
 * The key is derived from TOKEN_ENCRYPTION_KEY (already mandatory for OAuth, never used raw: a distinct
 * derivation label keeps the MAC key separate from the AES key). A missing key throws (fail closed).
 * Nothing here is ever logged; callers only get a reason code.
 */
import crypto from 'crypto';

export const OAUTH_STATE_TTL_SECONDS = 600; // same as the cookie maxAge
const CLOCK_SKEW_SECONDS = 60;
const VERSION = 'v1';
const STATE_RE = /^[0-9a-f]{64}$/;
const MAC_RE = /^[0-9a-f]{64}$/;

export type OAuthStateRejection =
  | 'missing_cookie'
  | 'malformed_cookie'
  | 'malformed_state'
  | 'state_mismatch'
  | 'expired'
  | 'binding_mismatch';

export type OAuthStateVerdict =
  | { ok: true }
  /** `consume`: the cookie was a well-formed one of ours and must be deleted (it must never be reusable). */
  | { ok: false; reason: OAuthStateRejection; consume: boolean };

export interface OAuthStateSubject {
  marketplace: string;
  workspaceId: string;
  userId: string;
}

function macKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes');
  return crypto.createHmac('sha256', key).update('adksy:oauth-state-binding:v1').digest();
}

function computeMac(state: string, issuedAt: number, subject: OAuthStateSubject): string {
  const material = [VERSION, subject.marketplace.toLowerCase(), state, subject.workspaceId, subject.userId, String(issuedAt)].join('\n');
  return crypto.createHmac('sha256', macKey()).update(material).digest('hex');
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Value of the `oauth_state_<marketplace>` cookie, bound to the verified workspace/user that starts the flow. */
export function createBoundStateCookieValue(state: string, subject: OAuthStateSubject, nowMs: number = Date.now()): string {
  if (!STATE_RE.test(state)) throw new Error('Invalid OAuth state');
  const issuedAt = Math.floor(nowMs / 1000);
  return `${VERSION}.${state}.${issuedAt}.${computeMac(state, issuedAt, subject)}`;
}

/**
 * Callback side. `cookieValue`: raw cookie (may be undefined); `queryState`: `state` of the callback URL;
 * `subject`: the CURRENT verified session workspace/user. Never throws on bad input (only on a missing key).
 */
export function verifyBoundState(
  cookieValue: string | undefined,
  queryState: string,
  subject: OAuthStateSubject,
  nowMs: number = Date.now()
): OAuthStateVerdict {
  if (!cookieValue) return { ok: false, reason: 'missing_cookie', consume: false };
  if (!STATE_RE.test(queryState)) return { ok: false, reason: 'malformed_state', consume: false };

  const parts = cookieValue.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION || !STATE_RE.test(parts[1]) || !/^\d{1,12}$/.test(parts[2]) || !MAC_RE.test(parts[3])) {
    return { ok: false, reason: 'malformed_cookie', consume: false };
  }
  const [, cookieState, issuedAtText, mac] = parts;

  // state of the URL must equal the state of the cookie (constant time)
  if (!safeEqual(queryState, cookieState)) return { ok: false, reason: 'state_mismatch', consume: false };

  const issuedAt = Number(issuedAtText);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (nowSeconds - issuedAt > OAUTH_STATE_TTL_SECONDS || issuedAt - nowSeconds > CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'expired', consume: true };
  }

  // binding: the CURRENT session workspace/user must be the ones that started the flow
  if (!safeEqual(mac, computeMac(cookieState, issuedAt, subject))) {
    return { ok: false, reason: 'binding_mismatch', consume: true };
  }
  return { ok: true };
}
