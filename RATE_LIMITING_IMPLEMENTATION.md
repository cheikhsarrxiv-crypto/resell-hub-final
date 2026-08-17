# 🔒 RATE LIMITING IMPLEMENTATION

**Status**: IMPLEMENTED (in-memory by default, ready for Upstash)

---

## Architecture

### Backend Options
1. **In-Memory** (default, development)
   - No external dependencies
   - Data resets on server restart
   - Good for development/testing

2. **Upstash Redis** (production)
   - Persistent across restarts
   - Distributed (works with multiple servers)
   - Requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

---

## Configuration

### Environment Variables
```
# Backend selection
RATE_LIMIT_BACKEND=memory|upstash (default: memory)

# Upstash configuration (if RATE_LIMIT_BACKEND=upstash)
UPSTASH_REDIS_REST_URL=https://...redishost.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxxx
```

### Default Limits
| Endpoint | Limit | Window |
|----------|-------|--------|
| login | 5 | 15 minutes |
| signup | 3 | 1 hour |
| API | 100 | 1 hour |
| upload | 50 | 1 hour |
| stripe | 50 | 1 hour |
| fulfillment | 100 | 1 hour |

---

## Implementation

### Location
`src/lib/ratelimit.ts` - Singleton service

### Usage in Routes

```typescript
import { rateLimiter, RateLimiterService } from '@/lib/ratelimit';

// In your API route
export async function POST(request: NextRequest) {
  // Rate limit by email (login)
  const rateLimitResult = await rateLimiter.checkLogin(email);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000).toString(),
        },
      }
    );
  }
  
  // Continue with route logic
}
```

### Protected Routes

#### Implemented ✅
- POST /api/auth/signup (3 per hour by IP)

#### Ready to Add ⏳
- POST /api/auth/[...nextauth]/signin (5 per 15min by email)
- GET /api/products (100 per hour by userId)
- POST /api/products (100 per hour by userId)
- POST /api/products/[id]/images (50 per hour by userId)
- POST /api/stripe/checkout (50 per hour by userId)
- POST /api/stripe/webhooks (exempt - signature verified)
- POST /api/fulfillment/* (100 per hour by workspaceId)

---

## Testing

### Development (In-Memory)
No setup needed. Limits reset on server restart.

```bash
# Start server
npm run dev

# Test signup rate limit
for i in {1..4}; do
  curl -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"test123"}'
done

# 4th request should return 429
```

### Production (Upstash)
Requires Upstash Redis Free tier setup.

```bash
# Set environment
RATE_LIMIT_BACKEND=upstash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxx

# Run in production
npm run build && npm run start
```

---

## Monitoring

### Response Headers
All rate-limited endpoints return:
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Reset: 2026-08-12T12:15:00Z
Retry-After: 300
```

### Logging
- Fallback to in-memory on Upstash error
- Console warnings in production if using in-memory
- No logs for rate-limited requests (by design)

---

## Production Readiness

### Current Status
✅ **IMPLEMENTED + TESTED (in-memory)**
❌ **NOT TESTED (Upstash, production)**

### Blockers for Production
1. Upstash account + credentials required
2. All critical routes need protection added
3. Load testing with Upstash

### Timeline
- Add to 15+ routes: 2-3 hours
- Test with Upstash: 1 hour
- Load test: 2-4 hours

