/**
 * Rate Limiter Service
 * Supports multiple backends: Upstash Redis, in-memory (dev)
 * 
 * Environment Variables:
 * RATE_LIMIT_BACKEND=upstash|memory (default: memory for dev)
 * UPSTASH_REDIS_REST_URL=https://...
 * UPSTASH_REDIS_REST_TOKEN=xxxxx
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface RateLimitConfig {
  points: number; // Max requests
  duration: number; // Time window in seconds
}

const DEFAULT_CONFIGS = {
  login: { points: 5, duration: 900 }, // 5 per 15 minutes
  signup: { points: 3, duration: 3600 }, // 3 per hour
  api: { points: 100, duration: 3600 }, // 100 per hour
  upload: { points: 50, duration: 3600 }, // 50 per hour
  stripe: { points: 50, duration: 3600 }, // 50 per hour
  fulfillment: { points: 100, duration: 3600 }, // 100 per hour
  emailVerification: { points: 3, duration: 3600 }, // 3 per hour
} as const;

type LimitType = keyof typeof DEFAULT_CONFIGS;

/**
 * In-Memory Rate Limiter (development only)
 */
class InMemoryRateLimiter {
  private storage = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.storage.get(key);

    if (!entry || now > entry.resetAt) {
      this.storage.set(key, {
        count: 1,
        resetAt: now + config.duration * 1000,
      });
      return {
        success: true,
        limit: config.points,
        remaining: config.points - 1,
        resetAt: new Date(now + config.duration * 1000),
      };
    }

    entry.count++;

    if (entry.count > config.points) {
      return {
        success: false,
        limit: config.points,
        remaining: 0,
        resetAt: new Date(entry.resetAt),
      };
    }

    return {
      success: true,
      limit: config.points,
      remaining: config.points - entry.count,
      resetAt: new Date(entry.resetAt),
    };
  }
}

/**
 * Upstash Redis Rate Limiter (production)
 */
class UpstashRateLimiter {
  private url: string;
  private token: string;

  constructor() {
    this.url = process.env.UPSTASH_REDIS_REST_URL || '';
    this.token = process.env.UPSTASH_REDIS_REST_TOKEN || '';

    if (!this.url || !this.token) {
      throw new Error('Upstash requires UPSTASH_REDIS_REST_URL and token');
    }
  }

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    try {
      const redisKey = `ratelimit:${key}`;

      const response = await fetch(`${this.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', redisKey],
          // NX: only set the TTL when the key has none yet (i.e. on the
          // first request of a window). Without NX, this EXPIRE re-runs on
          // every call — including ones that already fail the limit — and
          // keeps pushing the TTL back, so a key under sustained traffic
          // never expires and the counter never resets: a fixed window
          // that in practice never re-opens.
          ['EXPIRE', redisKey, config.duration, 'NX'],
          ['TTL', redisKey],
        ]),
      });

      if (!response.ok) {
        throw new Error(`Upstash error: ${response.statusText}`);
      }

      const results = await response.json();
      const [incrResult, , ttlResult] = results;
      const count = incrResult.result || 1;
      const ttl = ttlResult.result || config.duration;
      const resetAt = new Date(Date.now() + ttl * 1000);

      if (count > config.points) {
        return {
          success: false,
          limit: config.points,
          remaining: 0,
          resetAt,
        };
      }

      return {
        success: true,
        limit: config.points,
        remaining: config.points - count,
        resetAt,
      };
    } catch (error) {
      console.error('[RateLimiter] Upstash error:', error);
      // Fallback: allow on error
      return {
        success: true,
        limit: config.points,
        remaining: Math.floor(config.points / 2),
        resetAt: new Date(Date.now() + config.duration * 1000),
      };
    }
  }
}

/**
 * Rate Limiter Service
 */
export class RateLimiterService {
  private backend: InMemoryRateLimiter | UpstashRateLimiter;

  constructor() {
    const backendType = process.env.RATE_LIMIT_BACKEND;
    const hasUpstashCredentials = Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    );

    // Use Upstash whenever it's explicitly requested, or automatically
    // whenever its credentials are present (e.g. Vercel's Upstash
    // integration injects them without anyone also having to remember to
    // set RATE_LIMIT_BACKEND=upstash). RATE_LIMIT_BACKEND=memory still
    // forces in-memory, for local dev even if those vars leak into env.
    const useUpstash =
      backendType === 'upstash' || (backendType !== 'memory' && hasUpstashCredentials);

    if (useUpstash) {
      try {
        this.backend = new UpstashRateLimiter();
        console.log('[RateLimiter] Using Upstash Redis');
      } catch {
        console.warn('[RateLimiter] Falling back to in-memory');
        this.backend = new InMemoryRateLimiter();
      }
    } else {
      this.backend = new InMemoryRateLimiter();
      if (process.env.NODE_ENV === 'production') {
        console.warn(
          '[RateLimiter] In-memory in production — set UPSTASH_REDIS_REST_URL ' +
          'and UPSTASH_REDIS_REST_TOKEN to enable distributed rate limiting ' +
          '(required on Vercel: each serverless instance has its own memory).'
        );
      }
    }
  }

  async check(
    identifier: string,
    type: LimitType = 'api'
  ): Promise<RateLimitResult> {
    const config = DEFAULT_CONFIGS[type];
    const key = `${type}:${identifier}`;
    return this.backend.check(key, config);
  }

  async checkLogin(email: string): Promise<RateLimitResult> {
    return this.check(email, 'login');
  }

  async checkSignup(ip: string): Promise<RateLimitResult> {
    return this.check(`signup:${ip}`, 'signup');
  }

  async checkAPI(userId: string): Promise<RateLimitResult> {
    return this.check(userId, 'api');
  }

  async checkUpload(userId: string): Promise<RateLimitResult> {
    return this.check(userId, 'upload');
  }

  async checkStripe(userId: string): Promise<RateLimitResult> {
    return this.check(userId, 'stripe');
  }

  async checkFulfillment(workspaceId: string): Promise<RateLimitResult> {
    return this.check(workspaceId, 'fulfillment');
  }

  async checkEmailVerification(userId: string): Promise<RateLimitResult> {
    return this.check(userId, 'emailVerification');
  }

  static getClientIP(request: Request): string {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    return request.headers.get('x-real-ip') || 'unknown';
  }
}

export const rateLimiter = new RateLimiterService();

export async function withRateLimit(
  request: Request,
  identifier: string,
  type: LimitType = 'api'
) {
  const result = await rateLimiter.check(identifier, type);

  if (!result.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
        }),
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString(),
            'X-RateLimit-Limit': result.limit.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': result.resetAt.toISOString(),
          },
        }
      ),
    };
  }

  return {
    success: true,
    headers: {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': result.resetAt.toISOString(),
    },
  };
}
