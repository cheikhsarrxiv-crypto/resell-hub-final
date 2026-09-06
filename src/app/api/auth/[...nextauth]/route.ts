import { NextRequest, NextResponse } from 'next/server';
import { handlers } from '@/auth';
import { rateLimiter } from '@/lib/ratelimit';

export const { GET } = handlers;

/**
 * Rate-limits credentials login before it reaches NextAuth's handler.
 *
 * Login previously called rateLimiter.checkLogin() inside authorize()
 * (src/auth.ts), but authorize() returning null just makes NextAuth treat
 * it as "invalid credentials" — the callback route still responds 200, so
 * a client (or an attacker's script) can't distinguish "wrong password"
 * from "rate limited" and never sees a 429/Retry-After to back off on.
 * Checking here, before handlers.POST(), lets a real limit violation
 * short-circuit with a real 429.
 *
 * request.clone() is required: reading the body via .formData() consumes
 * the original stream, and NextAuth's own handler still needs to read
 * (email, password, csrfToken, ...) from it afterward.
 */
export async function POST(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/auth/callback/credentials') {
    try {
      const formData = await request.clone().formData();
      const email = formData.get('email');

      if (typeof email === 'string' && email) {
        const rateLimitResult = await rateLimiter.checkLogin(email);

        if (!rateLimitResult.success) {
          const retryAfter = Math.ceil(
            (rateLimitResult.resetAt.getTime() - Date.now()) / 1000
          );

          return NextResponse.json(
            { error: 'Too many login attempts. Please try again later.' },
            {
              status: 429,
              headers: {
                'Retry-After': retryAfter.toString(),
                'X-RateLimit-Limit': rateLimitResult.limit.toString(),
                'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
                'X-RateLimit-Reset': rateLimitResult.resetAt.toISOString(),
              },
            }
          );
        }
      }
    } catch (error) {
      // Malformed body, unexpected content-type, etc. — don't let a
      // parsing failure block login; fall through to NextAuth's own
      // handler, which will reject a genuinely malformed request itself.
      console.error('[Auth] Failed to read credentials body for rate limiting:', error);
    }
  }

  return handlers.POST(request);
}
