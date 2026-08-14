# 🔌 EXTERNAL SERVICES SETUP

**Status**: Code ready, credentials required

---

## 1. STRIPE — Payment Processing

### Status
- ✅ Code implemented (StripeService, routes, webhooks)
- ⚠️ Webhook signature verification ready
- ⚠️ Idempotent handlers implemented
- ❌ NOT TESTED — Stripe test credentials required

### Setup Steps

```bash
# 1. Create Stripe account (free tier)
# Go to: https://dashboard.stripe.com/register

# 2. Switch to Test Mode (top right toggle)

# 3. Get API Keys
# Settings → API Keys → Reveal key
# Copy:
# - Publishable key (pk_test_...)
# - Secret key (sk_test_...)

# 4. Create 6 Price IDs in Stripe Dashboard
# Products → Create Product
# For each: Starter, Pro, Business (monthly + annual)
# Example monthly: price_1234567890abcdef

# 5. Configure environment variables
# Add to .env.local:
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

STRIPE_PRICE_ID_STARTER_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_STARTER_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_PRO_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_ANNUAL=price_xxxxx

# 6. Create Webhook Endpoint
# Webhooks → Add endpoint
# URL: https://yoursite.com/api/stripe/webhooks
# Events: customer.subscription.*, invoice.payment_*
# Copy webhook secret

# 7. Test with test card
# Use: 4242 4242 4242 4242 (any future date, any CVC)
# Go to /subscription page
# Click "Upgrade to Pro"
# Complete payment flow
# Verify webhook received in Stripe dashboard

# 8. Verify in database
# Check subscription created in DB
# Verify plan limits enforced
```

### Test Flow

```bash
1. Go to /subscription
2. Click "Upgrade to Pro"
3. Enter test card (4242 4242 4242 4242)
4. Complete checkout
5. Verify redirect + success message
6. Check Stripe dashboard → Events
7. Verify webhook received
8. Check database: subscription status = active
```

### Expected Results
- Checkout succeeds
- Webhook received + verified
- Subscription created in DB
- Plan limits enforced
- Cancellation works
- Failed payment (4000 0000 0000 0002) triggers error

---

## 2. SUPABASE — Image Storage

### Status
- ✅ Code implemented (StorageService, UI, routes)
- ✅ File validation ready
- ✅ Workspace isolation implemented
- ❌ NOT TESTED — Supabase credentials required

### Setup Steps

```bash
# 1. Create Supabase project (free tier)
# Go to: https://supabase.com/dashboard
# Sign up → Create new project
# Name: resellhub-storage
# Region: closest to your users
# Password: strong random

# 2. Get Database Credentials
# Settings → Database
# Copy connection string (not needed for storage)

# 3. Create Storage Bucket
# Storage → Create new bucket
# Name: products
# Set to PUBLIC (so images accessible)

# 4. Configure CORS
# Storage → products → CORS Policy
# Add:
# {
#   "allowedOrigins": ["https://yoursite.com"],
#   "allowedMethods": ["GET", "POST", "PUT", "DELETE"],
#   "allowedHeaders": ["*"]
# }

# 5. Get API Keys
# Settings → API
# Copy:
# - Project URL (https://xxxxx.supabase.co)
# - anon key (eyJ...)
# - service_role key (eyJ...)

# 6. Configure environment variables
# Add to .env.local:
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 7. Test upload
# Go to /products/[id]/images
# Click "Upload Images"
# Select image (JPEG/PNG, <10MB)
# Verify upload succeeds
# Check Supabase dashboard → Storage
```

### Test Flow

```bash
1. Go to products page
2. Create new product
3. Go to product → Manage Images
4. Drag & drop image (or click to select)
5. Verify upload progress
6. Verify image appears in gallery
7. Test reorder (drag images)
8. Test set main image (click star)
9. Test delete (click trash icon)
10. Verify changes in Supabase Storage bucket
```

### Expected Results
- Images upload successfully
- Images visible in gallery with preview
- Drag & drop reordering works
- Set main image works
- Delete removes image + from DB
- All images isolated by workspace

---

## 3. RESEND — Email Service

### Status
- ✅ Code implemented (EmailService, templates, providers)
- ✅ 10 email templates ready
- ✅ SendGrid, Mailgun, Resend support
- ❌ NOT TESTED — Resend API key required

### Setup Steps

```bash
# 1. Create Resend account (free tier)
# Go to: https://resend.com
# Sign up with email

# 2. Get API Key
# Dashboards → API Keys
# Create new key
# Copy: re_xxxxxxxxxxxxx

# 3. Add to environment
# Add to .env.local:
EMAIL_PROVIDER=resend
EMAIL_FROM=noreply@resellhub.local
EMAIL_FROM_NAME=ResellHub
RESEND_API_KEY=re_xxxxx

# 4. Test email sending
# Create test user/signup
# Verify email in console logs + Resend dashboard

# 5. Test templates
# Welcome email: signup
# New order: create order
# Payment failed: simulate failed payment
# Subscription: upgrade plan
```

### Test Flow

```bash
1. Signup new user
   → Check: Welcome email received
   
2. Create product + place order
   → Check: New order email
   
3. Try payment with failing card
   → Check: Payment failed email

4. Upgrade to paid plan
   → Check: Subscription created email

5. Cancel subscription
   → Check: Subscription canceled email
```

### Expected Results
- Emails delivered to inbox (or Resend dashboard)
- Templates render correctly
- Variables substituted
- From name/address correct
- No hardcoded URLs
- All email types working

### Alternative: Mailgun

```bash
# If using Mailgun instead:
EMAIL_PROVIDER=mailgun
MAILGUN_API_KEY=key-xxxxx (from mailgun.com)
MAILGUN_DOMAIN=mg.yoursite.com
```

### Alternative: SendGrid

```bash
# If using SendGrid instead:
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxx (from sendgrid.com)
```

---

## Environment Variables Checklist

### Required for Production

```bash
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_URL=https://yoursite.com
NEXTAUTH_SECRET=xxx (32+ random chars)

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_*_* (6 price IDs)

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Email
EMAIL_PROVIDER=resend|mailgun|sendgrid
RESEND_API_KEY=re_... (if Resend)
MAILGUN_API_KEY=key-... (if Mailgun)
SENDGRID_API_KEY=SG.... (if SendGrid)
EMAIL_FROM=noreply@yoursite.com
EMAIL_FROM_NAME=YourApp

# Rate Limiting
RATE_LIMIT_BACKEND=upstash|memory (default: memory)
UPSTASH_REDIS_REST_URL=https://...upstash.io (if Upstash)
UPSTASH_REDIS_REST_TOKEN=xxx (if Upstash)

# Admin
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

---

## Verification Checklist

### Stripe
- [ ] Stripe account created (test mode)
- [ ] 6 price IDs created
- [ ] API keys in .env.local
- [ ] Webhook endpoint configured
- [ ] Test payment succeeds
- [ ] Webhook received + logged
- [ ] Subscription created in DB

### Supabase
- [ ] Supabase project created
- [ ] Storage bucket "products" created
- [ ] CORS configured
- [ ] API keys in .env.local
- [ ] Test image upload succeeds
- [ ] Image visible in storage bucket
- [ ] Gallery displays image

### Email
- [ ] Email provider account created
- [ ] API key in .env.local
- [ ] Test email sent
- [ ] Email delivered to inbox
- [ ] Templates render correctly
- [ ] Variables substituted

---

## Troubleshooting

### Stripe Not Connecting
```
Error: "STRIPE_SECRET_KEY not found"
Solution: Check .env.local has STRIPE_SECRET_KEY=sk_test_...
```

### Supabase Upload Fails
```
Error: "CORS error"
Solution: Configure CORS in Supabase Storage bucket settings
```

### Email Not Sending
```
Error: "EMAIL_PROVIDER_NOT_CONFIGURED"
Solution: Set EMAIL_PROVIDER and corresponding API key
```

### 429 Rate Limits (Stripe, Supabase, Email)
```
Solution: These services have rate limits
Stripe: 100/sec
Supabase: Generous free tier
Resend: 100/day free tier
```

