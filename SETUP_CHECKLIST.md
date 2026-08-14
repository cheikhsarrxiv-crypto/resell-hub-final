# 📋 SETUP CHECKLIST — REAL ENVIRONMENT VALIDATION

**Date**: 12 August 2026

---

## 🎯 BEFORE YOU START

### Important Rules
- ✅ All secrets go to `.env.local` ONLY
- ✅ `.env.local` is in `.gitignore` — never commit
- ✅ Never put secrets in code
- ✅ Never put secrets in git
- ✅ Verify nothing is committed by accident: `git status`

### Location of .env.local
```
/home/claude/reselling-saas/.env.local
```

### What Already Exists
- ✅ All code is READY
- ✅ All configurations are prepared
- ✅ All routes exist
- ✅ Just need credentials and configuration

---

## 1️⃣ POSTGRESQL SETUP

### Step 1: Start PostgreSQL with Docker

```bash
# Run PostgreSQL container
docker run -d \
  --name resellhub-postgres \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_DB=resellhub_dev \
  -p 5432:5432 \
  postgres:15

# Wait 10 seconds for database to start
sleep 10

# Verify it's running
docker ps | grep resellhub-postgres
# Should show container running
```

### Step 2: Set DATABASE_URL in .env.local

```bash
# Open .env.local
nano /home/claude/reselling-saas/.env.local

# Add this line:
DATABASE_URL="postgresql://postgres:devpassword@localhost:5432/resellhub_dev"

# Save and close (Ctrl+X, Y, Enter)
```

### Step 3: Apply Migrations

```bash
cd /home/claude/reselling-saas

# Install dependencies (if not done)
npm install

# Apply all migrations
npm run db:push

# Expected output:
# ✓ Created 26 models
# ✓ Created migrations
# ✓ Database ready
```

### Step 4: Verify PostgreSQL Connection

```bash
# Test connection with Prisma
npx prisma db execute --stdin << 'SQL'
SELECT version();
SQL

# Expected output:
# PostgreSQL 15.x on...
```

### Step 5: Create Test Product (for later testing)

```bash
npx prisma db execute --stdin << 'SQL'
INSERT INTO "Workspace" (id, name, plan) 
VALUES ('ws-test-1', 'Test Workspace', 'free');

INSERT INTO "Product" (id, workspaceId, title, description, quantity, price)
VALUES ('prod-race-1', 'ws-test-1', 'Test Product', 'For race condition test', 1, 100);
SQL

# Expected output:
# Successfully executed
```

### Secrets in PostgreSQL Setup
```
SECRET: devpassword (dev only, ok in .env.local)
KEEP IN: .env.local only
DON'T COMMIT: .env.local is in .gitignore ✓
```

---

## 2️⃣ UPSTASH REDIS SETUP

### Step 1: Create Upstash Account

1. Go to: https://console.upstash.com
2. Sign up (free tier available)
3. Verify email
4. Create new organization

### Step 2: Create Redis Database

1. Click "Create Database"
2. Choose name: `resellhub-dev`
3. Region: Select closest to your location
4. Click "Create"
5. Wait for database to be ready (~30 seconds)

### Step 3: Get Credentials

1. Click on your database
2. Click "Details" tab
3. Copy REST API section:
   - **REST URL**: `https://red-xxxxx.upstash.io`
   - **REST Token**: `AYW...` (starts with AYW)

### Step 4: Add to .env.local

```bash
# Open .env.local
nano /home/claude/reselling-saas/.env.local

# Add these lines:
RATE_LIMIT_BACKEND=upstash
UPSTASH_REDIS_REST_URL=https://red-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AYW...

# Save (Ctrl+X, Y, Enter)
```

### Step 5: Verify Upstash Connection

```bash
cd /home/claude/reselling-saas

# Restart app
npm run dev

# In browser, check console for:
# "Rate limiter: Connected to Upstash"
```

### Secrets in Upstash Setup
```
SECRET: UPSTASH_REDIS_REST_TOKEN (keep secret!)
KEEP IN: .env.local only
DON'T COMMIT: .env.local is in .gitignore ✓
DON'T SHARE: Token gives access to your Redis
```

---

## 3️⃣ STRIPE TEST MODE SETUP

### Step 1: Create Stripe Account

1. Go to: https://dashboard.stripe.com/register
2. Enter email and password
3. Verify email
4. Complete company info (can be fake for testing)
5. Click "Skip for now" if asked for business verification

### Step 2: Activate Test Mode

1. In Stripe dashboard, top right: see toggle
2. Click toggle to turn ON "Test mode"
3. Left sidebar turns blue (test mode active)
4. Rest of instructions are in TEST MODE

### Step 3: Create Products & Prices

In Stripe Test Mode Dashboard:

```
Products → Add Product

Create 6 products:

1. Starter - Monthly
   Name: Starter Monthly
   Price: 29 USD/month
   Billing period: monthly
   Copy Price ID: price_xxxxx

2. Starter - Annual  
   Name: Starter Annual
   Price: 290 USD/year
   Billing period: yearly
   Copy Price ID: price_xxxxx

3. Pro - Monthly
   Name: Pro Monthly
   Price: 79 USD/month
   Billing period: monthly
   Copy Price ID: price_xxxxx

4. Pro - Annual
   Name: Pro Annual
   Price: 790 USD/year
   Billing period: yearly
   Copy Price ID: price_xxxxx

5. Business - Monthly
   Name: Business Monthly
   Price: 199 USD/month
   Billing period: monthly
   Copy Price ID: price_xxxxx

6. Business - Annual
   Name: Business Annual
   Price: 1990 USD/year
   Billing period: yearly
   Copy Price ID: price_xxxxx
```

### Step 4: Get API Keys

In Stripe Test Mode:

1. Left sidebar → Developers
2. Click "API keys"
3. You'll see two keys:
   - **Publishable key**: Starts with `pk_test_`
   - **Secret key**: Starts with `sk_test_`
4. Copy both

### Step 5: Get Webhook Secret

In Stripe Test Mode:

1. Left sidebar → Developers → Webhooks
2. Click "Add endpoint" or "Create endpoint"
3. Endpoint URL: `http://localhost:3000/api/stripe/webhooks`
4. Events: Select:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click "Add endpoint"
6. Copy "Signing secret" (starts with `whsec_`)

### Step 6: Add to .env.local

```bash
# Open .env.local
nano /home/claude/reselling-saas/.env.local

# Add these lines:
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_ID_STARTER_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_STARTER_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_PRO_ANNUAL=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_MONTHLY=price_xxxxx
STRIPE_PRICE_ID_BUSINESS_ANNUAL=price_xxxxx

# Save (Ctrl+X, Y, Enter)
```

### Step 7: Verify Stripe Connection

```bash
cd /home/claude/reselling-saas

# Restart app
npm run dev

# Check: No errors in console about missing Stripe keys
```

### Secrets in Stripe Setup
```
SECRETS: 
- STRIPE_SECRET_KEY (sk_test_...)
- STRIPE_WEBHOOK_SECRET (whsec_...)

KEEP IN: .env.local only
DON'T COMMIT: .env.local is in .gitignore ✓
DON'T SHARE: These give access to your Stripe account
```

---

## 4️⃣ SUPABASE STORAGE SETUP

### Step 1: Create Supabase Account

1. Go to: https://supabase.com
2. Click "Start your project"
3. Sign up with email or GitHub
4. Verify email
5. Create organization

### Step 2: Create New Project

1. In Supabase dashboard, click "New project"
2. Name: `resellhub`
3. Database password: Generate or create (will need it)
4. Region: Select closest to your location
5. Click "Create new project"
6. Wait for project to be ready (~2 minutes)

### Step 3: Create Storage Bucket

In Supabase Project:

1. Left sidebar → Storage
2. Click "Create a new bucket"
3. Name: `products`
4. Make it PUBLIC (toggle on)
5. Click "Create bucket"

### Step 4: Configure CORS

In Supabase Project:

1. Left sidebar → Settings → Storage
2. In "CORS" section, add:
```
Origin: http://localhost:3000
Allow Headers: Authorization, Content-Type
Allow Methods: GET, POST, PUT, DELETE, OPTIONS
```
3. Click "Save"

### Step 5: Get API Keys

In Supabase Project:

1. Left sidebar → Settings → API
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon Key**: Starts with `eyJ` (JWT token)
   - **Service Role Key**: Starts with `eyJ` (JWT token)

### Step 6: Add to .env.local

```bash
# Open .env.local
nano /home/claude/reselling-saas/.env.local

# Add these lines:
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Save (Ctrl+X, Y, Enter)
```

### Step 7: Verify Supabase Connection

```bash
cd /home/claude/reselling-saas

# Restart app
npm run dev

# Check: No errors in console about missing Supabase keys
```

### Secrets in Supabase Setup
```
SECRETS:
- SUPABASE_SERVICE_ROLE_KEY (eyJ... service role)

SEMI-PUBLIC:
- NEXT_PUBLIC_SUPABASE_URL (safe to have in code)
- NEXT_PUBLIC_SUPABASE_ANON_KEY (limited permissions)

KEEP IN: .env.local
DON'T COMMIT: .env.local is in .gitignore ✓
DON'T SHARE: Service role key gives full access
```

---

## 5️⃣ RESEND EMAIL SETUP

### Step 1: Create Resend Account

1. Go to: https://resend.com
2. Click "Sign up"
3. Enter email and password
4. Verify email
5. Complete setup (free tier available)

### Step 2: Create API Key

In Resend Dashboard:

1. Left sidebar → API Keys
2. Click "Create API Key"
3. Name: `resellhub-dev`
4. Copy the key (starts with `re_`)

### Step 3: Verify Sender Email (for production)

In Resend Dashboard:

1. Left sidebar → Domains
2. For testing, use default: `onboarding@resend.dev`
3. For production: Add your domain and verify TXT records

### Step 4: Add to .env.local

```bash
# Open .env.local
nano /home/claude/reselling-saas/.env.local

# Add these lines:
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM=onboarding@resend.dev
EMAIL_FROM_NAME=ResellHub

# Save (Ctrl+X, Y, Enter)
```

### Step 5: Verify Resend Connection

```bash
cd /home/claude/reselling-saas

# Restart app
npm run dev

# Check: No errors in console about missing Resend keys
```

### Secrets in Resend Setup
```
SECRET: RESEND_API_KEY (re_...)

KEEP IN: .env.local only
DON'T COMMIT: .env.local is in .gitignore ✓
DON'T SHARE: API key gives access to send emails
```

---

## 6️⃣ SENTRY ERROR TRACKING SETUP

### Step 1: Create Sentry Account

1. Go to: https://sentry.io
2. Click "Try for free" or "Sign up"
3. Create account with email/password
4. Verify email
5. Create organization

### Step 2: Create New Project

In Sentry Dashboard:

1. Click "Create Project"
2. Select platform: "Next.js"
3. Name: `resellhub`
4. Alert email: your email
5. Click "Create Project"

### Step 3: Get DSN

In Sentry Project Settings:

1. Go to Settings (left sidebar)
2. Click "Projects"
3. Select "resellhub"
4. Click "Client Keys (DSN)"
5. Copy the DSN (format: `https://xxxxx@yyyyy.ingest.sentry.io/zzzzzz`)

### Step 4: Add to .env.local

```bash
# Open .env.local
nano /home/claude/reselling-saas/.env.local

# Add these lines:
SENTRY_DSN=https://xxxxx@yyyyy.ingest.sentry.io/zzzzzz
ENVIRONMENT=development
APP_VERSION=1.0.0

# Save (Ctrl+X, Y, Enter)
```

### Step 5: Verify Sentry Connection

```bash
cd /home/claude/reselling-saas

# Restart app
npm run dev

# Check: No errors in console about missing Sentry DSN
```

### Secrets in Sentry Setup
```
SECRET: SENTRY_DSN (but structure includes public key)

KEEP IN: .env.local only
DON'T COMMIT: .env.local is in .gitignore ✓
DON'T SHARE: DSN gives access to project
```

---

## ✅ FINAL VERIFICATION

### Check .env.local is Configured

```bash
cd /home/claude/reselling-saas

# Verify file exists and is in .gitignore
cat .gitignore | grep ".env.local"
# Should show: .env.local

# Check file is NOT empty
wc -l .env.local
# Should show: more than 0 lines

# Verify no secrets in git
git status
# Should show: On branch main (no .env.local listed)
```

### Check No Secrets in Code

```bash
cd /home/claude/reselling-saas

# Search for accidental secrets in source code
grep -r "pk_test_\|sk_test_\|whsec_\|re_[a-z]" src/ --include="*.ts" --include="*.tsx" 2>/dev/null || echo "✓ No test keys in source"

grep -r "eyJ[A-Za-z0-9]" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules || echo "✓ No JWT tokens in source"
```

### Restart Application

```bash
cd /home/claude/reselling-saas

# Kill any running instance
pkill -f "npm run dev" || true

# Start fresh
npm run dev

# Watch console for:
# ✓ No "missing environment variable" errors
# ✓ No "ENOENT" errors
# ✓ Server starts on port 3000
```

---

## 📊 SETUP SUMMARY

```
SERVICE          SETUP TIME   STATUS
─────────────────────────────────────
PostgreSQL       15 min       ⬜ Ready
Upstash Redis    10 min       ⬜ Ready
Stripe           20 min       ⬜ Ready
Supabase         15 min       ⬜ Ready
Resend           10 min       ⬜ Ready
Sentry           10 min       ⬜ Ready
─────────────────────────────────────
TOTAL            80 min       ⬜ Ready

.env.local       Configured  ⬜ Ready
No secrets in git            ⬜ Ready
App running                  ⬜ Ready
```

---

## 🛑 TROUBLESHOOTING

### PostgreSQL Connection Error
```bash
# Check if container is running
docker ps | grep resellhub-postgres

# If not, restart
docker restart resellhub-postgres

# Check DATABASE_URL in .env.local
grep DATABASE_URL /home/claude/reselling-saas/.env.local
```

### Upstash Connection Error
```bash
# Verify credentials
grep UPSTASH_REDIS /home/claude/reselling-saas/.env.local

# Test connection
curl https://red-xxxxx.upstash.io -H "Authorization: Bearer AYW..."
```

### Stripe Keys Not Working
```bash
# Verify test mode is enabled in Stripe dashboard
# (Dashboard toggle should be BLUE)

# Verify keys start with correct prefix
grep STRIPE /home/claude/reselling-saas/.env.local
# pk_test_ should be there
# sk_test_ should be there
```

### Supabase Connection Error
```bash
# Verify project is running
# Go to https://supabase.com/dashboard

# Verify bucket is PUBLIC
# Storage → products bucket → Edit (should be PUBLIC)

# Verify CORS is configured
# Settings → Storage → CORS configured
```

### Resend API Not Working
```bash
# Verify API key is correct
grep RESEND_API_KEY /home/claude/reselling-saas/.env.local

# Test with curl
curl -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer re_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"from":"onboarding@resend.dev","to":"test@example.com","subject":"Test","html":"Test"}'
```

### Sentry Not Capturing Errors
```bash
# Verify DSN is correct
grep SENTRY_DSN /home/claude/reselling-saas/.env.local

# Check Sentry dashboard
# Should show: "Awaiting first event..."
# Then send a test error to trigger
```

---

## 📝 NEXT STEP

When setup is complete:
1. ✅ All 6 services configured
2. ✅ All keys in .env.local
3. ✅ .env.local NOT in git
4. ✅ App running without errors

→ Run VALIDATION_CHECKLIST.md to test each service

