# ✅ VALIDATION CHECKLIST — REAL ENVIRONMENT TESTS

**Date**: 12 August 2026

**After Setup**: Execute these tests to validate each service is working

---

## 🎯 FORMAT FOR RESULTS

For each test, mark:
```
✅ PASS     — Test succeeded, service working
❌ FAIL     — Test failed, something wrong
⚠️ BLOCKED  — Missing credentials, cannot test
```

---

## 1️⃣ POSTGRESQL REAL TEST

### Test Setup
```bash
cd /home/claude/reselling-saas

# Verify database is running
docker ps | grep resellhub-postgres
```

### Test 1: Connection Verify
```bash
npx prisma db execute --stdin << 'SQL'
SELECT version();
SQL

Expected: PostgreSQL 15.x...
Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 2: Stock Race Condition (2 concurrent)
```bash
# Create test with 2 concurrent reservations on 1 stock
# This will be in: POSTGRES_REAL_TEST_GUIDE.md

Expected:
- Request 1: SUCCESS (stock 1 → 0)
- Request 2: FAIL (stock already 0)
- Final stock: 0 (never negative)

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 3: Email Verification Migration
```bash
npx prisma db execute --stdin << 'SQL'
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'EmailVerificationToken';
SQL

Expected: EmailVerificationToken table exists

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 4: Migrations Applied
```bash
npx prisma migrate status

Expected: All migrations applied ✓

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Summary PostgreSQL
```
Total Tests: 4
Passed: __/4
Failed: __/4
Blocked: __/4
```

---

## 2️⃣ UPSTASH REDIS REAL TEST

### Prerequisites
- ✅ RATE_LIMIT_BACKEND=upstash in .env.local
- ✅ UPSTASH_REDIS_REST_URL configured
- ✅ UPSTASH_REDIS_REST_TOKEN configured
- ✅ App running (npm run dev)

### Test 1: Login Rate Limit (5 per 15 min)
```bash
# Make 6 login requests in rapid succession
for i in {1..6}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test$i@example.com\",\"password\":\"test\"}"
done

Expected:
- Requests 1-5: 200 or 401 (not 429)
- Request 6: 429 (Too Many Requests)

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 2: Signup Rate Limit (3 per hour)
```bash
for i in {1..4}; do
  curl -s -o /dev/null -w "Signup $i: %{http_code}\n" \
    -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"signup$i@example.com\",\"password\":\"test\"}"
done

Expected:
- Requests 1-3: 200 or 400 (not 429)
- Request 4: 429 (Too Many Requests)

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 3: Redis Persistence (After Restart)
```bash
# Make 3 signup requests
for i in {1..3}; do
  curl -s -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"persist$i@example.com\",\"password\":\"test\"}"
done

# Stop and restart app
pkill -f "npm run dev"
sleep 2
npm run dev

# Try 4th signup
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"persist4@example.com\",\"password\":\"test\"}"

Expected: 429 (rate limit persisted from Redis)

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 4: Different Endpoints Different Limits
```bash
# Make 6 login requests
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"diff$i@example.com\",\"password\":\"test\"}"
done

# Result: 5th succeeds, 6th is 429

# Make 4 signup requests
for i in {1..4}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"diffagain$i@example.com\",\"password\":\"test\"}"
done

# Result: 3rd succeeds, 4th is 429

Expected: Each endpoint has independent limit counter

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Summary Upstash Redis
```
Total Tests: 4
Passed: __/4
Failed: __/4
Blocked: __/4
```

---

## 3️⃣ STRIPE TEST MODE REAL TEST

### Prerequisites
- ✅ Stripe account created
- ✅ Test Mode ENABLED (dashboard toggle is BLUE)
- ✅ 6 products created with prices
- ✅ Webhook endpoint configured
- ✅ All keys in .env.local
- ✅ App running

### Test 1: Checkout Session Creation
```bash
curl -X POST http://localhost:3000/api/stripe/checkout \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxxxx",
    "workspaceId": "ws-test-1"
  }'

Expected Response:
- Status: 200
- Body contains: sessionUrl (Stripe checkout link)
- URL format: https://checkout.stripe.com/...

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 2: Successful Payment
```bash
# Visit Stripe checkout link from Test 1
# Use test card: 4242 4242 4242 4242
# Expiry: Any future date
# CVC: Any 3 digits

Expected:
- Payment succeeds
- Return to success page
- Webhook fires in Stripe dashboard

Check Stripe Dashboard:
- Customers → New customer created
- Subscriptions → New subscription created

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 3: Failed Payment
```bash
curl -X POST http://localhost:3000/api/stripe/checkout \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxxxx",
    "workspaceId": "ws-test-1"
  }'

# Use test card: 4000 0000 0000 0002 (always fails)

Expected:
- Payment fails
- Error message shown
- NO subscription created
- Stripe dashboard shows failed payment

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 4: Subscription Cancellation
```bash
curl -X DELETE http://localhost:3000/api/stripe/subscription \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-test-1"
  }'

Expected:
- Status: 200
- Subscription cancelled
- Stripe shows: Subscription status = Canceled

Check Stripe Dashboard:
- Subscriptions → Status = Canceled
- Webhook: customer.subscription.deleted fired

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Summary Stripe
```
Total Tests: 4
Passed: __/4
Failed: __/4
Blocked: __/4
```

---

## 4️⃣ SUPABASE STORAGE REAL TEST

### Prerequisites
- ✅ Supabase project created
- ✅ "products" bucket created and PUBLIC
- ✅ CORS configured
- ✅ All keys in .env.local
- ✅ App running

### Test 1: Image Upload
```bash
# Navigate to: http://localhost:3000/products/new
# Or use product edit page

# Upload a JPEG or PNG image (less than 10MB)

Expected:
- Image accepted
- Appears in preview
- File uploaded to Supabase bucket

Check Supabase:
- Storage → products bucket
- Should see folder with workspace ID
- Image file inside

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 2: Set Main Image
```bash
# From product with 3+ images
# Click star icon on image 2

Expected:
- Badge "Main" appears on image 2
- Product preview shows image 2 as main
- Badge removed from other images

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 3: Reorder Images
```bash
# Upload 3 images to product
# Drag image 3 to position 1

Expected:
- Visual order changes
- Refresh page: Order persists
- Database shows new order

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 4: Workspace Isolation
```bash
# User A: Upload image to Product A
# User B: Login with different account
# User B: Try to view Product A images

Expected:
- User B CANNOT see User A's images
- User B CANNOT access image URLs directly
- No cross-workspace image access

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Summary Supabase
```
Total Tests: 4
Passed: __/4
Failed: __/4
Blocked: __/4
```

---

## 5️⃣ RESEND EMAIL REAL TEST

### Prerequisites
- ✅ Resend account created
- ✅ API key configured
- ✅ All keys in .env.local
- ✅ App running
- ✅ Access to test email inbox

### Test 1: Welcome Email
```bash
# Sign up new user
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-welcome@example.com",
    "password": "test123"
  }'

Expected:
- Signup succeeds
- Welcome email received in inbox
- Subject line: "Welcome to ResellHub"
- Contains user info

Check Resend Dashboard:
- Dashboard → Emails
- Show "Welcome to ResellHub"
- Status: Delivered

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 2: Order Notification Email
```bash
# Create an order (if feature available)

Expected:
- Order notification email received
- Subject: "Your ResellHub Order"
- Contains order details, total, etc.

Check Resend Dashboard:
- Email status: Delivered

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 3: Subscription Confirmation Email
```bash
# Upgrade to paid plan via Stripe

Expected:
- Subscription confirmation email received
- Subject: "Subscription Activated"
- Contains plan details, billing cycle
- Contains next billing date

Check Resend Dashboard:
- Email status: Delivered

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 4: Delivery Verification
```bash
# Check Resend Dashboard
# Dashboard → Emails section
# Look at last 3 emails

Expected:
- All emails show "Delivered"
- No bounces
- No complaints
- Timestamps show recent times

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Summary Resend
```
Total Tests: 4
Passed: __/4
Failed: __/4
Blocked: __/4
```

---

## 6️⃣ SENTRY ERROR TRACKING REAL TEST

### Prerequisites
- ✅ Sentry account created
- ✅ Project created
- ✅ DSN in .env.local
- ✅ App running
- ✅ Access to Sentry dashboard

### Test 1: Intentional Error Capture
```bash
# Create error in app (add to a route temporarily)
// In any route handler:
try {
  throw new Error('TEST_SENTRY_ERROR - Manual test');
} catch (error) {
  captureException(error);
}

# Visit the route

Expected:
- Error appears in Sentry dashboard
- Error title: TEST_SENTRY_ERROR
- Error marked as "New"

Check Sentry Dashboard:
- Issues → Should show TEST_SENTRY_ERROR

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 2: PII Filtering Verification
```bash
# Check the error in Sentry dashboard
# Look at error details (Request, Headers, Environment)

Expected:
- NO plaintext passwords visible
- NO API keys visible
- NO auth tokens visible
- Sensitive data should show: [REDACTED] or [FILTERED]

Look for:
- Headers: Authorization should be filtered
- Cookies: Should be filtered
- Environment: No secrets visible

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 3: Breadcrumbs Tracking
```bash
# Add breadcrumbs before error:
// In same route:
addBreadcrumb({
  message: 'User action 1',
  level: 'info'
});
addBreadcrumb({
  message: 'Database query',
  level: 'info'
});
throw new Error('TEST_BREADCRUMBS');

# Visit the route

Expected:
- Error captured in Sentry
- Breadcrumbs section shows activity
- Breadcrumbs in order

Check Sentry:
- Click error
- Scroll to "Breadcrumbs"
- Should show: User action 1, Database query

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Test 4: Performance Monitoring
```bash
# Let app run for 10 minutes with normal usage
# Make some requests to different endpoints

Expected:
- Sentry tracks request performance
- Performance data appears in dashboard

Check Sentry:
- Performance → Transactions
- Should show requests with timing
- Response times recorded

Result: ☐ ✅ PASS | ☐ ❌ FAIL | ☐ ⚠️ BLOCKED
```

### Summary Sentry
```
Total Tests: 4
Passed: __/4
Failed: __/4
Blocked: __/4
```

---

## 📊 FINAL VALIDATION SUMMARY

### Results Table

```
Service          | Tests | Passed | Failed | Blocked | Status
─────────────────┼───────┼────────┼────────┼─────────┼────────
PostgreSQL       |  4    |   __   |   __   |   __    | ☐
Upstash Redis    |  4    |   __   |   __   |   __    | ☐
Stripe           |  4    |   __   |   __   |   __    | ☐
Supabase         |  4    |   __   |   __   |   __    | ☐
Resend           |  4    |   __   |   __   |   __    | ☐
Sentry           |  4    |   __   |   __   |   __    | ☐
─────────────────┼───────┼────────┼────────┼─────────┼────────
TOTAL            | 24    |   __   |   __   |   __    | ☐
```

### Success Criteria

```
✅ FULLY VALIDATED if:
- PostgreSQL: 4/4 PASS
- Upstash: 4/4 PASS
- Stripe: 4/4 PASS
- Supabase: 4/4 PASS
- Resend: 4/4 PASS
- Sentry: 4/4 PASS

⚠️ PARTIALLY VALIDATED if:
- Any service: 3/4 or 2/4 PASS
- Some features blocked but core working

❌ NEEDS WORK if:
- Any service: 0/4 or 1/4 PASS
- Service not functioning
```

---

## 📝 NEXT STEPS AFTER VALIDATION

### If All Tests PASS (24/24 ✅)
```
✅ Production Environment READY
✅ All 6 services VALIDATED
✅ Can proceed to Phase 2.9

Next: Start Marketplace APIs
Timeline: Immediate
```

### If Some Tests FAIL (< 24/24)
```
⚠️ Identify failing service
⚠️ Check TROUBLESHOOTING in SETUP_CHECKLIST.md
⚠️ Re-run configuration for failing service
⚠️ Re-test that service

Timeline: 30-60 minutes to fix
```

### If Tests BLOCKED (credentials missing)
```
❌ Cannot proceed without credentials
❌ Must get account/credentials
❌ Re-run tests with credentials

Timeline: Setup 30-60 min, then test
```

---

## 🛑 IMPORTANT NOTES

- ✅ Run tests in order (PostgreSQL → Sentry)
- ✅ Test one service at a time
- ✅ Take screenshots of failures for debugging
- ✅ Document any errors you encounter
- ✅ Check .env.local is configured correctly

---

## STATUS

**Ready to validate**: ⏸️ Awaiting your signal to start tests

**Next message**: Send validation results in this format:

```
PostgreSQL:   ✅ PASS (4/4) or ❌ FAIL (2/4) or ⚠️ BLOCKED
Upstash:      ✅ PASS (4/4) or ❌ FAIL or ⚠️ BLOCKED
Stripe:       ✅ PASS (4/4) or ❌ FAIL or ⚠️ BLOCKED
Supabase:     ✅ PASS (4/4) or ❌ FAIL or ⚠️ BLOCKED
Resend:       ✅ PASS (4/4) or ❌ FAIL or ⚠️ BLOCKED
Sentry:       ✅ PASS (4/4) or ❌ FAIL or ⚠️ BLOCKED

Total: __/24 PASSED
```

