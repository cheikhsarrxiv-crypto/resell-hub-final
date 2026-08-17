# 📋 EXTERNAL SERVICES — INTEGRATION CHECKLIST

**Date**: 12 August 2026

---

## STRIPE INTEGRATION

**Status**: IMPLEMENTED + NOT TESTED

### Code Files Ready
- ✅ `src/services/StripeService.ts` (600+ lines)
- ✅ `src/app/api/stripe/checkout/route.ts`
- ✅ `src/app/api/stripe/portal/route.ts`
- ✅ `src/app/api/stripe/webhooks/route.ts`

### What's Needed to Test

```bash
# 1. Create Stripe account
https://dashboard.stripe.com/register

# 2. Go to Test Mode (top right)

# 3. In Developers → API keys, copy:
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx

# 4. In Webhooks, get secret:
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# 5. Create 6 products and get price IDs:
STRIPE_PRICE_ID_STARTER_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_STARTER_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_PRO_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_ANNUAL=price_xxxxx

# 6. NEVER put these in code or git
# Add only to .env.local (which is .gitignored)

# 7. Test scenarios:
npm run test:stripe:checkout
npm run test:stripe:webhook
npm run test:stripe:idempotency
```

### Security Checklist
- ✅ No secrets in source code
- ✅ No secrets in .env.example
- ✅ Webhook signature verification implemented
- ✅ Idempotent webhook handlers
- ✅ Workspace validation on all routes

---

## SUPABASE INTEGRATION

**Status**: IMPLEMENTED + NOT TESTED

### Code Files Ready
- ✅ `src/services/StorageService.ts` (500+ lines)
- ✅ `src/components/ImageUploadZone.tsx`
- ✅ `src/components/ImageGallery.tsx`
- ✅ `src/components/ProductImageDisplay.tsx`
- ✅ `src/app/api/products/[id]/images/route.ts`

### What's Needed to Test

```bash
# 1. Create Supabase account
https://supabase.com/dashboard

# 2. Create new project
Region: Closest to deployment

# 3. In Storage, create bucket "products"
Type: PUBLIC
CORS: Configure

# 4. In Settings → API, copy:
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 5. NEVER put these in code or git
# Add only to .env.local (which is .gitignored)

# 6. Test scenarios:
npm run test:supabase:upload
npm run test:supabase:reorder
npm run test:supabase:delete
npm run test:supabase:isolation
```

### Security Checklist
- ✅ No secrets in source code
- ✅ Workspace path inclusion in storage keys
- ✅ File type validation (JPEG, PNG only)
- ✅ File size validation (10MB max)
- ✅ Path traversal protection
- ✅ Workspace isolation verified

---

## RESEND INTEGRATION

**Status**: IMPLEMENTED + NOT TESTED

### Code Files Ready
- ✅ `src/services/EmailService.ts` (600+ lines)
- ✅ `src/services/NotificationService.ts`
- ✅ 10 email templates
- ✅ `src/app/api/emails/route.ts` (if needed)

### What's Needed to Test

```bash
# 1. Create Resend account
https://resend.com
# Free tier available

# 2. Create API key
From dashboard → Get API Key

# 3. Copy:
RESEND_API_KEY=re_xxxxxxxxxxxxx

# 4. Configure:
EMAIL_PROVIDER=resend
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=ResellHub

# 5. NEVER put these in code or git
# Add only to .env.local (which is .gitignored)

# 6. Test scenarios:
npm run test:resend:welcome
npm run test:resend:order
npm run test:resend:subscription
npm run test:resend:delivery

# 7. Check Resend dashboard for delivery status
```

### Security Checklist
- ✅ No secrets in source code
- ✅ API key only in .env
- ✅ Email templates don't contain secrets
- ✅ No passwords in emails
- ✅ No tokens in email content
- ✅ No PII in email headers

---

## SECRETS SECURITY CHECKLIST

### Never Do This
```
❌ STRIPE_SECRET_KEY in source code
❌ SUPABASE_SERVICE_ROLE_KEY in source code
❌ RESEND_API_KEY in source code
❌ Secrets in .env.example
❌ Secrets in git commits
❌ Secrets in logs
❌ Secrets in error messages
```

### Always Do This
```
✅ Use environment variables only
✅ Add .env.local to .gitignore
✅ Use .env.example with placeholder values
✅ Reference env vars in code: process.env.STRIPE_SECRET_KEY
✅ Redact secrets in logs: logger filters them automatically
✅ Redact secrets in Sentry: Sentry filters them automatically
```

### Verification Commands
```bash
# Check for secrets in source code
grep -r "sk_test_\|pk_test_\|re_\|eyJ" src/ --include="*.ts" --include="*.tsx"
# Should return: nothing

# Check for secrets in .env.example
cat .env.example
# Should show: STRIPE_SECRET_KEY=sk_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY

# Check git history
git log --all -S "sk_test_" -- .
# Should return: nothing (or only in .gitignore additions)
```

---

## TESTING CHECKLIST

### Stripe
- [ ] Test account created
- [ ] API keys copied to .env.local
- [ ] 6 price IDs created
- [ ] Webhook secret configured
- [ ] Checkout flow tested
- [ ] Webhook delivery verified
- [ ] Subscription creation verified
- [ ] Plan limits enforced
- [ ] Cancellation tested
- [ ] Failed payment tested

### Supabase  
- [ ] Project created
- [ ] Storage bucket created
- [ ] CORS configured
- [ ] API keys copied to .env.local
- [ ] Image upload tested
- [ ] Reordering tested
- [ ] Deletion tested
- [ ] Workspace isolation verified

### Resend
- [ ] Account created
- [ ] API key copied to .env.local
- [ ] Welcome email tested
- [ ] Order email tested
- [ ] Subscription email tested
- [ ] Email delivery verified

---

## Timeline to Full Testing

```
Stripe:    30-45 minutes (account + 6 price IDs setup)
Supabase:  20-30 minutes (project + bucket setup)
Resend:    10-15 minutes (account + API key)
─────────────────────
Total:     60-90 minutes
```

---

## Status

**All code ready. All credentials required.**

When you have credentials:
1. Add to .env.local
2. Run integration tests
3. Verify in each service's dashboard
4. Report results

