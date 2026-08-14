# 🔗 EXTERNAL SERVICES REAL TEST GUIDES

---

## STRIPE TEST MODE

**Status**: Ready to test (needs Stripe test account)

### What's Ready
- ✅ `src/services/StripeService.ts` (600+ lines)
- ✅ `/api/stripe/checkout` route
- ✅ `/api/stripe/webhooks` route
- ✅ Webhook signature verification
- ✅ Subscription management

### What's Needed

```bash
# 1. Create Stripe account
https://dashboard.stripe.com/register

# 2. Switch to Test Mode (top right corner)

# 3. Create 6 products with prices
# Dashboard → Products
# Create: Starter Monthly, Starter Annual, Pro Monthly, Pro Annual, Business Monthly, Business Annual

# 4. Get API keys
# Dashboard → Developers → API keys
# Copy:
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# 5. Add to .env.local (DO NOT COMMIT)
cat >> .env.local << 'EOF'
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_ID_STARTER_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_STARTER_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_PRO_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_ANNUAL=price_xxxxx
EOF
```

### Test Scenarios

**1. Successful Checkout**:
```bash
curl -X POST http://localhost:3000/api/stripe/checkout \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxxxx",
    "workspaceId": "ws-test"
  }'

# Expected: Stripe session URL returned
# Visit URL, enter test card: 4242 4242 4242 4242
# Complete payment
# Webhook should fire (check Stripe dashboard)
# Subscription created in database
# User upgraded to paid plan
```

**2. Failed Payment**:
```bash
curl -X POST http://localhost:3000/api/stripe/checkout \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxxxx",
    "workspaceId": "ws-test"
  }'

# Use test card: 4000 0000 0000 0002 (will fail)
# Expected: Payment rejected
# NO subscription created
```

**3. Webhook Delivery**:
```bash
# Install Stripe CLI
https://stripe.com/docs/stripe-cli

# Start webhook forwarding
stripe listen --forward-to localhost:3000/api/stripe/webhooks --events customer.subscription.updated,invoice.payment_succeeded

# Make a charge in Stripe dashboard
# Webhook should trigger
# Check application logs
```

**4. Cancellation**:
```bash
curl -X DELETE http://localhost:3000/api/stripe/subscription \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-test"
  }'

# Expected: Subscription cancelled
# User downgraded to Free plan
# Webhook fires: customer.subscription.deleted
```

### Blocking Issues

**No Stripe Account**: Cannot test without account

**Result**: BLOCKED — STRIPE TEST ACCOUNT REQUIRED

---

## SUPABASE STORAGE

**Status**: Ready to test (needs Supabase project)

### What's Ready
- ✅ `src/services/StorageService.ts` (500+ lines)
- ✅ `src/components/ImageUploadZone.tsx`
- ✅ `/api/products/[id]/images` routes
- ✅ File validation (JPEG, PNG only)
- ✅ Workspace isolation

### What's Needed

```bash
# 1. Create Supabase account
https://supabase.com

# 2. Create new project
# Region: Closest to your deployment

# 3. Create storage bucket
# Storage → Create bucket → "products" (PUBLIC)

# 4. Configure CORS
# Settings → Storage → CORS
# Add: http://localhost:3000

# 5. Get API keys
# Settings → API → URL and Keys
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 6. Add to .env.local (DO NOT COMMIT)
cat >> .env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
EOF
```

### Test Scenarios

**1. Upload Image**:
```bash
# Navigate to product edit page
# Upload JPEG/PNG image
# Expected: Image appears in gallery
# Check Supabase Storage → products bucket
# File should exist with workspace ID in path
```

**2. Reorder Images**:
```bash
# Upload 3 images
# Drag image to new position
# Expected: Order persists on page reload
# Database shows new order
```

**3. Set Main Image**:
```bash
# Click star icon on image 2
# Expected: Badge "Main" appears
# Image appears as main in product preview
```

**4. Workspace Isolation**:
```bash
# User A uploads image
# Login as User B
# Expected: Image A NOT visible to User B
# Storage path includes workspace ID
# Direct URL access denied
```

### Blocking Issues

**No Supabase Project**: Cannot test without project

**Result**: BLOCKED — SUPABASE PROJECT REQUIRED

---

## RESEND EMAIL

**Status**: Ready to test (needs Resend API key)

### What's Ready
- ✅ `src/services/EmailService.ts` (600+ lines)
- ✅ 10 email templates
- ✅ Resend integration
- ✅ SendGrid/Mailgun fallback

### What's Needed

```bash
# 1. Create Resend account
https://resend.com
# (Free tier available)

# 2. Get API key
# API Keys → Copy

# 3. Verify sender email
# Emails → Add sender domain
# Verify TXT records

# 4. Add to .env.local (DO NOT COMMIT)
cat >> .env.local << 'EOF'
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=ResellHub
EOF
```

### Test Scenarios

**1. Welcome Email**:
```bash
# Sign up new user
# Expected: Welcome email sent to inbox
# Check Resend dashboard for delivery status
```

**2. Order Notification**:
```bash
# Create new order
# Expected: Order notification email sent
# Contains order details, total, shipping address
```

**3. Subscription Confirmation**:
```bash
# Upgrade to Pro plan
# Expected: Subscription confirmation email
# Contains plan details, billing cycle
```

**4. Delivery Verification**:
```bash
# Check Resend dashboard
# All emails should show "Delivered"
# No bounces or complaints
```

### Blocking Issues

**No Resend Account**: Cannot send emails without account

**Result**: BLOCKED — RESEND API KEY REQUIRED

---

## SENTRY ERROR TRACKING

**Status**: Ready to test (needs Sentry account)

### What's Ready
- ✅ `src/lib/sentry.ts` (Sentry integration)
- ✅ PII filtering
- ✅ Sensitive data masking
- ✅ Error capture hooks

### What's Needed

```bash
# 1. Create Sentry account
https://sentry.io

# 2. Create new project
# Select: Next.js

# 3. Get DSN
# Settings → Projects → <Your Project> → Client Keys (DSN)
# Copy DSN

# 4. Add to .env.local (DO NOT COMMIT)
cat >> .env.local << 'EOF'
SENTRY_DSN=https://xxxxx@yyyyy.ingest.sentry.io/zzzzzz
ENVIRONMENT=development
APP_VERSION=1.0.0
EOF

# 5. Restart app
npm run dev
```

### Test Scenarios

**1. Capture Exception**:
```bash
# Add this to any route:
try {
  throw new Error('Test error for Sentry');
} catch (error) {
  captureException(error);
}

# Visit route to trigger error
# Check Sentry dashboard
# Error should appear in Issues
```

**2. Verify No Secrets**:
```bash
# Check Sentry dashboard for error
# Look at error details
# Verify: No passwords, tokens, API keys visible
# Should see: [REDACTED] for sensitive data
```

**3. Test Breadcrumbs**:
```bash
# Add breadcrumbs before error:
addBreadcrumb('order', 'Order created', 'info');
addBreadcrumb('payment', 'Payment processing', 'info');

# Trigger error
# Check Sentry
# Breadcrumbs should appear in order
```

**4. Performance Monitoring**:
```bash
# Make requests to application
# Wait 5-10 minutes
# Check Sentry → Performance
# Should see request performance metrics
```

### Blocking Issues

**No Sentry Account**: Cannot track errors without account

**Result**: BLOCKED — SENTRY ACCOUNT REQUIRED

---

## CREDENTIALS STATUS SUMMARY

| Service | Needed | Status |
|---------|--------|--------|
| PostgreSQL | Database URL | BLOCKED |
| Upstash | API URL + Token | BLOCKED |
| Stripe | Test keys + Price IDs | BLOCKED |
| Supabase | Project URL + Keys | BLOCKED |
| Resend | API Key | BLOCKED |
| Sentry | DSN | BLOCKED |

---

## How to Proceed

When you have credentials:

```bash
# 1. Add all credentials to .env.local
# DO NOT add to git

# 2. Restart application
npm run dev

# 3. Run each test scenario in order

# 4. Check dashboards for results
# - Stripe: Payment successful
# - Supabase: Files in storage
# - Resend: Email delivered
# - Sentry: Error captured

# 5. Report results
```

---

## Status

All code: ✅ READY
All credentials: ❌ MISSING
All tests: ❌ BLOCKED

