# 📍 UPSTASH REDIS REAL TEST GUIDE

**Status**: Ready to test (needs Upstash credentials)

---

## What's Ready

### Code Ready
- ✅ `src/lib/ratelimit.ts` — Rate limiter with Upstash support
- ✅ Logic: In-memory fallback tested
- ✅ Configuration: Environment variables ready

### What's Needed

```bash
# Get from Upstash Console (console.upstash.com)
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AY...

# Add to .env.local (DO NOT COMMIT)
# Example:
# UPSTASH_REDIS_REST_URL=https://red-c3h4k5i7j9.upstash.io
# UPSTASH_REDIS_REST_TOKEN=AYW1234567890abcdefghijklmnopqrstuvwxyz
```

---

## Test Scenario 1: Basic Rate Limiting

```bash
# 1. Create Upstash account
https://console.upstash.com

# 2. Create Redis database
Region: Closest to your location

# 3. Copy credentials to .env.local
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# 4. Restart app
npm run dev

# 5. Test endpoint
# First 5 requests to /api/auth/login should succeed
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# Watch response headers
# X-RateLimit-Limit: 5
# X-RateLimit-Remaining: 4
# X-RateLimit-Reset: ...

# 6th request should return 429
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# Expected: 429 Too Many Requests
```

---

## Test Scenario 2: Redis Persistence

```bash
# 1. Make 3 signup requests (limit is 3/hour)
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user1@example.com","password":"pass"}'

curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user2@example.com","password":"pass"}'

curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user3@example.com","password":"pass"}'

# All 3 succeed (HTTP 200)

# 2. 4th attempt should fail
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user4@example.com","password":"pass"}'

# Expected: 429 Too Many Requests

# 3. Restart application
# IMPORTANT: Rate limit state persists in Redis!

# 4. Try signup again
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user5@example.com","password":"pass"}'

# Expected: 429 (still limited, state persisted)

# 5. Wait 1 hour or clear Redis
# redis-cli -u $UPSTASH_REDIS_REST_URL FLUSHALL

# 6. Try signup again
# Expected: 200 (limit reset)
```

---

## Test Scenario 3: Multiple Endpoints

```bash
# Test that different endpoints have different limits

# Login (5/15 min)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pass"}'

# API (100/hour)
curl http://localhost:3000/api/products \
  -H "Authorization: Bearer token"

# Signup (3/hour)
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pass"}'

# Each should have independent counters
# X-RateLimit-Limit should vary
```

---

## Blocking Issues

**No Upstash Credentials**:
```
Cannot connect to Redis without Upstash account.
Needs:
- Upstash Redis database created
- REST URL and Token from Upstash Console
- .env.local configured
```

---

## How to Run Full Test

```bash
# 1. Create Upstash account and database

# 2. Get credentials
# From Upstash Console → Details → REST API

# 3. Add to .env.local
cat >> .env.local << 'EOF'
RATE_LIMIT_BACKEND=upstash
UPSTASH_REDIS_REST_URL=https://red-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AYW...
EOF

# 4. Create test script
cat > test-ratelimit.sh << 'EOF'
#!/bin/bash

# Test 1: Login limit
echo "Test 1: Login rate limit (5 per 15 min)"
for i in {1..6}; do
  echo "Attempt $i:"
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test$i@example.com\",\"password\":\"pass\"}"
done

# Expected output:
# 200 (success)
# 200 (success)
# 200 (success)
# 200 (success)
# 200 (success)
# 429 (rate limited)

echo ""
echo "Test 2: Signup limit (3 per hour)"
for i in {1..4}; do
  echo "Attempt $i:"
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"signup$i@example.com\",\"password\":\"pass\"}"
done

# Expected output:
# 200 (success)
# 200 (success)
# 200 (success)
# 429 (rate limited)
EOF

chmod +x test-ratelimit.sh
./test-ratelimit.sh
```

---

## Status

**Code**: ✅ READY
**Configuration**: ❌ MISSING (needs .env.local)
**Credentials**: ❌ NOT AVAILABLE

**Result**: BLOCKED — UPSTASH CREDENTIALS REQUIRED

---

## Expected Results (When Tested)

```
✓ Requests within limit return 200
✓ Requests over limit return 429
✓ Rate limit headers present
✓ Different endpoints have different limits
✓ State persists after app restart
✓ Counters reset after time window
```

