# 🚀 PHASE 2: MVP → SaaS Commercial

**Objectif**: Transformer ResellHub en produit SaaS commercialisable et génératrice de revenue

**Timeline**: 8-12 semaines
**Budget estimé**: Moderate (surtout dev time)
**Équipe**: 1-2 développeurs + 1 designer

---

## 1️⃣ UI/UX PREMIUM - SEMAINE 1-2

### 1.1 Design System Complet
**Status**: ❌ NOT DONE
**Effort**: 3-5 jours

Créer un design system cohérent avec:
- ✅ Couleurs (primary, secondary, success, warning, error)
- ✅ Typography (3-4 font sizes, weights)
- ✅ Spacing (8px grid system)
- ✅ Components (button variants, card types, modals)
- ✅ Icons (migrer de lucide-react)
- ✅ Dark mode support

**Fichiers à créer**:
```
src/styles/colors.ts          # Palette de couleurs
src/styles/spacing.ts         # Système d'espacement
src/styles/typography.ts      # Typographie
src/components/theme.tsx      # Theme provider
```

### 1.2 Landing Page
**Status**: ❌ NOT DONE
**Effort**: 4-5 jours

Créer une landing page professionnelle:
```
src/app/page.tsx (rewrite)
- Hero section avec CTA
- Feature showcase (5-6 features)
- Pricing table
- FAQ section
- Testimonials (mock ou réel)
- Footer
```

**Design**:
- Responsive mobile/desktop
- Animations subtiles (Framer Motion)
- Conversion optimized (CTA buttons)
- SEO friendly

### 1.3 Onboarding Flow
**Status**: ❌ PARTIAL
**Effort**: 3-4 jours

Créer onboarding complet:
```
1. Welcome screen
   └─ src/app/(onboarding)/welcome/page.tsx

2. Account setup
   └─ src/app/(onboarding)/setup/account/page.tsx
   └─ Validate email
   └─ Confirm password

3. Workspace setup
   └─ src/app/(onboarding)/setup/workspace/page.tsx
   └─ Name, country, description

4. First product
   └─ src/app/(onboarding)/setup/first-product/page.tsx
   └─ Guided product creation

5. Plan selection
   └─ src/app/(onboarding)/setup/plan/page.tsx
   └─ Choose subscription

6. Completion
   └─ src/app/(onboarding)/complete/page.tsx
   └─ Redirect to dashboard
```

**Features**:
- Progress indicator
- Step validation
- Save drafts
- Skip option (for power users)

### 1.4 Pricing Page
**Status**: ❌ NOT DONE
**Effort**: 2-3 jours

```
src/app/pricing/page.tsx
- Display 5 plans
- Feature comparison table
- FAQ section
- CTA buttons
- Toggle annual/monthly

Design:
- Highlight "Pro" plan
- Clear pricing
- Feature icons
- Annual discount (20-30%)
```

### 1.5 Responsive Design
**Status**: ✅ PARTIAL (Tailwind ok, mobile UX weak)
**Effort**: 2-3 jours

Audit et fix:
```
Mobile (< 768px):
- ✅ Cards stack vertically
- ❌ Sidebar → hamburger menu
- ❌ Tables → card view (list format)
- ❌ Forms → optimized input spacing

Tablet (768px - 1024px):
- ✅ 2-column layout

Desktop (> 1024px):
- ✅ 3-column layout
```

**Pages à tester**:
- [ ] Dashboard
- [ ] Products list
- [ ] Orders list
- [ ] Order detail
- [ ] Pricing

### 1.6 Loading & Error States
**Status**: ❌ NOT DONE
**Effort**: 2-3 jours

Créer composants réutilisables:

```typescript
// Loading skeletons
src/components/Skeleton/CardSkeleton.tsx
src/components/Skeleton/TableSkeleton.tsx
src/components/Skeleton/BarChartSkeleton.tsx

// Error pages
src/app/error.tsx (global error boundary)
src/app/not-found.tsx (404 page)
src/app/(dashboard)/error.tsx (dashboard error)

// Empty states
src/components/EmptyStates/NoProducts.tsx
src/components/EmptyStates/NoOrders.tsx
src/components/EmptyStates/NoListings.tsx
```

### 1.7 Notifications & Toasts
**Status**: ❌ NOT DONE
**Effort**: 1-2 jours

Ajouter toast notifications:
```
npm install react-hot-toast
# ou sonner (plus léger)

src/providers/ToastProvider.tsx
src/lib/toast.ts (helper functions)

Utilisation:
- Success: "Product created"
- Error: "Failed to create product"
- Info: "Syncing..."
- Warning: "This action cannot be undone"
```

---

## 2️⃣ PAIEMENTS STRIPE - SEMAINE 3-4

### 2.1 Setup Stripe
**Status**: ❌ NOT DONE
**Effort**: 1 jour

```bash
npm install stripe @stripe/react-stripe-js
```

Créer compte Stripe:
- [ ] Obtenir API keys (publishable + secret)
- [ ] Configurer webhooks
- [ ] Tester avec Stripe CLI
- [ ] Ajouter credentials à .env

### 2.2 Abonnements Stripe
**Status**: ❌ NOT DONE
**Effort**: 3-4 jours

Créer produits/pricing dans Stripe:

```
FREE (0€/month)
├─ 10 products
├─ 20 listings
└─ 50 orders

STARTER (14,99€/month)
├─ 100 products
├─ 300 listings
├─ 500 orders
└─ 2 marketplaces

PRO (29,99€/month)
├─ 500 products
├─ 1500 listings
├─ 2000 orders
├─ 4 marketplaces
└─ Fulfillment enabled

BUSINESS (59,99€/month)
├─ 5000 products
├─ 10000 listings
├─ Unlimited orders
├─ 4 marketplaces
├─ Multi-user
└─ API access

ANNUAL: -20% (16 months instead of 12)
```

**Database updates**:
```prisma
model Subscription {
  id                    String @id
  workspaceId          String
  stripeSubscriptionId String?    // Stripe subscription ID
  stripePriceId        String?    // Current price in Stripe
  status               String  // active, past_due, cancelled, unpaid
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  
  # Billing
  billingEmail         String?
  billingAddress       String?
  ...
}
```

### 2.3 Checkout Flow
**Status**: ❌ NOT DONE
**Effort**: 2-3 jours

Créer checkout flow:

```
src/app/(onboarding)/setup/payment/page.tsx
- Display plan details
- Stripe Elements form
- Pay button
- Show loading state
- Handle errors
- Redirect on success

API route:
src/app/api/stripe/create-subscription/route.ts
- Validate plan
- Create Stripe customer
- Create Stripe subscription
- Update database
- Return confirmation
```

**Features**:
- Credit card input (Stripe Elements)
- Error handling
- Loading states
- Success confirmation
- Email receipt

### 2.4 Billing Portal
**Status**: ❌ NOT DONE
**Effort**: 1-2 jours

Ajouter portail de gestion:

```
src/app/(dashboard)/billing/page.tsx
- Current plan display
- Usage metrics
- Upgrade/downgrade button
- Payment method
- Billing history
- Invoices download
- Cancel subscription button

Stripe Hosted Portal:
- Link to Stripe customer portal
- Allow users to:
  - Change payment method
  - Download invoices
  - Manage subscription
```

### 2.5 Webhooks Stripe
**Status**: ❌ NOT DONE
**Effort**: 1-2 jours

Créer webhook handlers:

```
src/app/api/stripe/webhooks/route.ts

Events à gérer:
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.payment_succeeded
- invoice.payment_failed

Pour chaque événement:
- Valider signature webhook
- Mettre à jour database
- Envoyer email si nécessaire
- Logger pour monitoring
```

### 2.6 Upgrade/Downgrade Logic
**Status**: ❌ NOT DONE
**Effort**: 1-2 jours

Gérer changement de plan:

```typescript
// Quand utilisateur change de plan
POST /api/stripe/change-subscription

Logic:
1. Récupérer Stripe subscription actuelle
2. Créer nouvelle subscription
3. Annuler l'ancienne
4. Mettre à jour database
5. Envoyer confirmation email
6. Appliquer prorating si nécessaire
```

**Cas spéciaux**:
- Upgrade: Prorating favorable à l'utilisateur
- Downgrade: Effet à la prochaine période
- Annulation: Remboursement possible

---

## 3️⃣ STORAGE (Images/Files) - SEMAINE 4-5

### 3.1 Choisir le Provider
**Status**: ❌ DECISION
**Options**:

| Provider | Cost | Setup | Pros | Cons |
|---|---|---|---|---|
| Supabase Storage | $5/100GB | Easy | PostgreSQL integration | Lié à Supabase |
| AWS S3 | $0.023/GB | Medium | Industry standard | Complex setup |
| Cloudinary | $50-200/month | Easy | Auto-optimize images | Cher |
| Uploadcare | Pay-as-you-go | Easy | Good docs | Vendor lock |
| Vercel Blob | Beta | Easy | Next.js integrated | Pas pour production |

**Recommandation**: Supabase Storage (car déjà PostgreSQL user)

### 3.2 Setup Supabase Storage
**Status**: ❌ NOT DONE
**Effort**: 1 jour

```bash
npm install @supabase/supabase-js

# Créer bucket "products-images" public

# Ajouter à .env:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
```

### 3.3 Image Upload Component
**Status**: ❌ NOT DONE
**Effort**: 2-3 jours

Créer composant upload:

```typescript
// src/components/ImageUpload.tsx
- Drag & drop support
- Multi-file select
- Preview thumbnails
- Progress bar
- Error handling
- File validation (size, type)
- Automatic resize/compress

Features:
- Max file size: 10MB
- Formats: JPG, PNG, WebP
- Auto-crop to 1:1 ratio
- Generate thumbnails (200x200, 500x500)
- Compress images before upload
```

### 3.4 Image Management in Products
**Status**: ❌ NOT DONE
**Effort**: 2-3 jours

Intégrer upload dans product creation:

```typescript
// src/app/(dashboard)/products/new/page.tsx
- Upload area for main image
- Upload area for gallery
- Set main image
- Reorder images (drag & drop)
- Delete image
- Crop images before upload
- Show CDN URLs in form
```

### 3.5 Image Optimization
**Status**: ❌ NOT DONE
**Effort**: 1-2 jours

Optimiser les images:

```typescript
// src/lib/image-optimizer.ts
- Resize to standard sizes (200x200, 500x500, 1000x1000)
- Compress with sharp
- Generate WebP versions
- Auto-crop/center
- Add fallback for missing images

// Utiliser dans <Image> tags
<Image
  src={product.images[0].url}
  alt={product.title}
  width={500}
  height={500}
  priority
  quality={80}
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
/>
```

### 3.6 Image Deletion Logic
**Status**: ❌ NOT DONE
**Effort**: 1 jour

Supprimer images:

```typescript
// Quand utilisateur supprime product
1. Récupérer toutes les images
2. Supprimer du storage Supabase
3. Supprimer des records database
4. Vérifier pas d'autres produits les utilisent
```

---

## 4️⃣ MARKETPLACE INTEGRATIONS - SEMAINE 5-7

### ⚠️ AUDIT PRÉALABLE REQUIS

Avant d'implémenter, vérifier réellement les APIs disponibles:

### 4.1 Vinted
**Status**: ❌ RESEARCH

```
API Availability: ⚠️ VERY LIMITED
- Vinted n'a pas d'API publique complète
- API partenaires uniquement sur invitation
- Nécessite contact direct avec Vinted

Alternatives:
1. Web scraping (illégal, contre ToS)
2. Partenariat direct avec Vinted
3. Intégration via channel manager
4. Mock for MVP (current status: ✅ OK)

Recommendation for Phase 2:
→ MOCK (pas d'API publique accessible)
→ Documenter que c'est mock
→ Préparer l'architecture pour connexion futur
```

### 4.2 eBay
**Status**: ❌ RESEARCH

```
API Availability: ✅ YES
- eBay Trading API (legacy, but works)
- eBay REST APIs (newer)
- Requirements:
  - Developer account (free)
  - Sandbox account (testing)
  - Production API keys
  - OAuth 2.0

Effort: 5-7 jours
Cost: Free (usage-based)

Capabilities:
✅ Create listings
✅ Update inventory
✅ Get orders
✅ Update order status
✅ Leave feedback
✅ Get seller metrics

Documentation: https://developer.ebay.com
```

### 4.3 Depop
**Status**: ❌ RESEARCH

```
API Availability: ⚠️ LIMITED
- Depop n'a pas d'API publique officielle
- Accès par partenariat uniquement
- Nécessite contacter Depop Business

Status for Phase 2:
→ MOCK (pas d'accès public)
→ Documenter que c'est mock
→ Préparer architecture pour futur
```

### 4.4 Etsy
**Status**: ❌ RESEARCH

```
API Availability: ✅ YES
- Etsy Shop API
- OAuth 2.0 flow
- Requirements:
  - App on Etsy developers
  - API key (free)
  - Shop authorization

Effort: 4-6 jours
Cost: Free (usage-based, 0.05 per API call)

Capabilities:
✅ Create listings
✅ Update listings
✅ Manage inventory
✅ Get orders
✅ Update order status

Documentation: https://www.etsy.com/developers
```

### 4.5 Implementation Strategy

**RECOMMENDATION FOR PHASE 2**:

```
START WITH: eBay + Etsy (APIs accessibles)

1. eBay Implementation (Semaine 5-6)
   ├─ Setup OAuth
   ├─ Implement adapters
   ├─ Test in sandbox
   ├─ Go live
   └─ Monitor errors

2. Etsy Implementation (Semaine 6-7)
   ├─ Setup OAuth
   ├─ Implement adapters
   ├─ Test
   └─ Go live

3. Vinted & Depop (Phase 3)
   └─ Keep as MOCK
   └─ Préparer architecture
   └─ Contact pour partenariat
```

### 4.6 eBay Integration (Detailed)

**Step 1: Setup OAuth**
```typescript
// src/services/marketplace/EbayOAuth.ts
- Implementer flow d'authentification
- Stocker refresh tokens securely
- Gérer token expiration
- Auto-refresh tokens
```

**Step 2: Implement Real Adapter**
```typescript
// src/services/marketplace/RealEbayAdapter.ts
class EbayAdapter extends MarketplaceAdapter {
  async createListing(data) {
    // Call real eBay API
    // Map our format to eBay format
    // Handle errors
    // Return eBay-specific data
  }
  
  async updateInventory(externalId, quantity) {
    // Update inventory on eBay
    // Handle out-of-stock
    // Delist if needed
  }
  
  // ... implement all other methods
}
```

**Step 3: Database Updates**
```prisma
model MarketplaceConnection {
  // Add eBay-specific fields
  ebayAuthToken    String?    // OAuth token
  ebayRefreshToken String?    // For token refresh
  ebayTokenExpires DateTime?   // When token expires
  ebayUserId       String?     // eBay account ID
  ebayShopName     String?     // Shop name for display
}
```

**Step 4: Add Authorization Page**
```
src/app/(dashboard)/marketplaces/ebay/auth/page.tsx
- Button to authorize with eBay
- Redirect to eBay OAuth
- Handle callback
- Store tokens
- Show connection status
```

### 4.7 Etsy Integration (Similar to eBay)
```
- OAuth setup
- Real adapter implementation
- Database fields for tokens
- Authorization UI
- Test listings creation
```

---

## 5️⃣ FULFILLMENT (3PL Integration) - SEMAINE 7-8

### 5.1 Fulfillment Architecture

**Current Status**: Mock implementation
**Goal for Phase 2**: Prepare for real 3PL connection

### 5.2 Choose 3PL Provider

Research partners:
```
Option 1: Shipbob (USA-based)
- $0.99 per order
- $2.00 per lb
- API available
- Good for resellers

Option 2: Flexport (enterprise)
- Custom pricing
- Full logistics
- API available
- Overkill for MVP

Option 3: Local 3PL in France
- Find local provider
- Custom integration
- Preferred for European sellers

Option 4: Self-fulfillment
- Use current mock system
- Create admin UI to manage
- Generate shipping labels
```

**RECOMMENDATION**: Stay with mock in Phase 2, prepare for 3PL in Phase 3

### 5.3 Fulfillment API Interface

Create universal interface:

```typescript
// src/services/fulfillment/FulfillmentProvider.ts

interface FulfillmentProvider {
  // Config
  name: string;
  credentials: {
    apiKey: string;
    apiSecret?: string;
    warehouseId?: string;
  };
  
  // Order management
  createOrder(order: Order): Promise<FulfillmentOrder>;
  updateOrder(id: string, status: string): Promise<void>;
  cancelOrder(id: string): Promise<void>;
  
  // Inventory
  syncInventory(items: InventoryItem[]): Promise<void>;
  getInventory(productId: string): Promise<number>;
  
  // Tracking
  getTracking(orderId: string): Promise<Tracking>;
  
  // Webhooks
  parseWebhook(payload: any): FulfillmentEvent;
  verifyWebhookSignature(payload: string, signature: string): boolean;
  
  // Health
  testConnection(): Promise<boolean>;
}
```

### 5.4 Webhook Handling (CRITICAL FIX)

```typescript
// src/app/api/fulfillment/webhooks/3pl/route.ts

POST endpoint for 3PL webhooks:
1. Verify signature (HMAC-SHA256)
2. Parse webhook payload
3. Update fulfillment order status
4. Update order status if needed
5. Create tracking event if shipping
6. Send notification to user
7. Log webhook for debugging

Events to handle:
- order.accepted
- order.processing
- order.shipped (with tracking)
- order.delivered
- order.failed
- order.cancelled
```

### 5.5 Error Handling & Retry Logic

```typescript
// src/services/fulfillment/RetryManager.ts

class FulfillmentRetryManager {
  // Retry strategy:
  // Attempt 1: immediately
  // Attempt 2: 5 minutes later
  // Attempt 3: 30 minutes later
  // Attempt 4: 2 hours later
  // Attempt 5: 24 hours later
  
  async retryFailedOrders() {
    // Find orders with failed fulfillment
    // Retry with exponential backoff
    // Log attempts
    // Alert after max retries
  }
}
```

### 5.6 Admin Dashboard for Fulfillment

```
src/app/(dashboard)/fulfillment/page.tsx
- Stats: orders processing, shipped, delivered
- Failed orders list (retry option)
- Webhook logs
- 3PL connection status
- API health check
```

---

## 6️⃣ ADMIN DASHBOARD (Business Metrics) - SEMAINE 8-9

### 6.1 Admin Access Control

```typescript
// Database change:
enum UserRole {
  USER = "user"
  WORKSPACE_ADMIN = "workspace_admin"
  PLATFORM_ADMIN = "platform_admin"  // New
}

model User {
  role UserRole = USER  // Add this field
}

// Routes:
src/middleware.ts - add check for PLATFORM_ADMIN role
src/app/(admin) - new section for admins only
```

### 6.2 Admin Dashboard Pages

```
src/app/(admin)/page.tsx - Overview
├─ Total metrics (all workspaces)
├─ Recent activity
└─ Alerts/issues

src/app/(admin)/users/page.tsx - User Management
├─ List all users
├─ Search/filter
├─ View user details
├─ Suspend/activate users
├─ View user's workspaces
└─ Download user data (GDPR)

src/app/(admin)/subscriptions/page.tsx - Subscription Analytics
├─ MRR chart
├─ ARR total
├─ Subscriptions by plan
├─ Churn rate
├─ LTV calculation
└─ Upgrade/downgrade trends

src/app/(admin)/orders/page.tsx - Order Analytics
├─ Total orders
├─ GMV (Gross Merchandise Value)
├─ AOV (Average Order Value)
├─ Orders by marketplace
├─ Orders by fulfillment type
└─ Failed orders

src/app/(admin)/fulfillment/page.tsx - Fulfillment Analytics
├─ Total fulfillment orders
├─ Fulfillment revenue
├─ Fulfillment costs
├─ Cost per order (average)
├─ Success rate
└─ 3PL performance metrics

src/app/(admin)/financial/page.tsx - Financial Dashboard
├─ Total revenue (subscriptions + fulfillment)
├─ Gross profit
├─ Net profit (after costs)
├─ Margin analysis
├─ Cost breakdown by category
└─ Revenue forecast

src/app/(admin)/monitoring/page.tsx - System Health
├─ API health
├─ Database status
├─ Background jobs status
├─ Error rates
├─ Performance metrics
└─ Webhook delivery status
```

### 6.3 Key Metrics to Calculate

```typescript
// src/services/admin/AdminAnalyticsService.ts

interface AdminMetrics {
  // Users
  totalUsers: number;
  activeUsers: number;
  newUsersThisMonth: number;
  userChurn: number;
  
  // Subscriptions
  mrr: number;  // Monthly Recurring Revenue
  arr: number;  // Annual Recurring Revenue
  subscriptionsByPlan: { [plan: string]: number };
  averageChurnRate: number;
  customerLifetimeValue: number;
  
  // Orders
  totalOrders: number;
  totalGMV: number;  // Gross Merchandise Value
  averageOrderValue: number;
  ordersPerUser: number;
  ordersByMarketplace: { [market: string]: number };
  
  // Fulfillment
  totalFulfillmentOrders: number;
  fulfillmentSuccessRate: number;
  fulfillmentRevenue: number;
  fulfillmentCosts: number;
  fulfillmentMargin: number;
  
  // Financial
  totalRevenue: number;
  totalCosts: number;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
  
  // Health
  apiErrorRate: number;
  webhookFailureRate: number;
  averageResponseTime: number;
  uptime: number;
}
```

### 6.4 Charts & Visualizations

```typescript
// Use Recharts (already in package.json)

// Revenue over time
<LineChart data={revenueTrend} />

// Subscriptions by plan
<PieChart data={subscriptionsByPlan} />

// Orders by marketplace
<BarChart data={ordersByMarketplace} />

// Fulfillment metrics
<ComposedChart>
  <Bar dataKey="revenue" fill="#10b981" />
  <Bar dataKey="costs" fill="#ef4444" />
  <Line dataKey="margin" />
</ComposedChart>

// Churn rate
<AreaChart data={churnTrend} />
```

### 6.5 Admin Settings

```
src/app/(admin)/settings/page.tsx
├─ Platform settings
│  ├─ Maintenance mode
│  ├─ Feature flags
│  └─ Email config
├─ API settings
│  ├─ Webhook configuration
│  └─ Rate limits
├─ Notifications
│  ├─ Alert thresholds
│  └─ Contact emails
└─ Integrations
   ├─ Stripe test mode
   └─ Analytics setup
```

---

## 7️⃣ SÉCURITÉ - SEMAINE 9-10

### 7.1 Audit de Sécurité Complet

```
Checklist:
☐ SQL Injection - Prisma ORM protège
☐ CSRF - NextAuth protège
☐ XSS - React auto-escapes HTML
☐ Authentication - JWT sessions avec NextAuth
☐ Authorization - Middleware + getVerifiedWorkspaceId
☐ Data Isolation - Multi-tenant workspace isolation
☐ Rate Limiting - ✅ Implémenté en Phase 1
☐ Secrets Management - .env + vault (needed)
☐ API Keys - Table exists, nécessite impl complète
☐ Webhook Validation - ✅ Implémenté pour Stripe + 3PL
☐ HTTPS Only - ✅ Obligatoire en prod
☐ Secure Headers - Ajouter Helmet middleware
☐ CORS - Configurer CORS pour APIs
☐ Input Validation - Zod schemas en place
☐ Output Encoding - React auto-encodes
☐ File Upload - Valider type/taille en Phase 3
☐ Third-party risks - Auditer Stripe, 3PL SDKs
```

### 7.2 Helmet Middleware

```bash
npm install helmet
```

```typescript
// src/middleware.ts (add)
import helmet from 'helmet';

// Ajoute security headers:
// X-Content-Type-Options: nosniff
// X-Frame-Options: DENY
// X-XSS-Protection: 1; mode=block
// Strict-Transport-Security: max-age=31536000
// Content-Security-Policy: ...
```

### 7.3 CORS Configuration

```typescript
// src/lib/cors.ts

export function getCorsHeaders(origin: string | null) {
  const allowedOrigins = [
    'https://reselling-saas.com',
    'https://www.reselling-saas.com',
    // Add other domains
  ];
  
  const isAllowed = allowedOrigins.includes(origin || '');
  
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}
```

### 7.4 API Keys Management

```typescript
// Implémenter complètement:
// src/app/(dashboard)/settings/api-keys/page.tsx
// - Generate new key
// - List keys
// - Revoke key
// - Set permissions
// - View last used

// src/app/api/apikey/route.ts
// - Validate API key (instead of session)
// - Different rate limits for API keys
// - Log usage
```

### 7.5 Webhook Validation

```typescript
// src/lib/webhook-validator.ts

// Pour chaque webhook:
function verifyStripeWebhook(payload: string, signature: string) {
  return crypto
    .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!)
    .update(payload)
    .digest('hex') === signature;
}

function verify3PLWebhook(payload: string, signature: string) {
  return crypto
    .createHmac('sha256', process.env.3PL_WEBHOOK_SECRET!)
    .update(payload)
    .digest('hex') === signature;
}
```

### 7.6 GDPR Compliance

```typescript
// Ajouter fonctionnalités:
// 1. Data Export
// src/app/api/user/export/route.ts
// - Export all user data as JSON
// - Include: user, workspace, products, orders, etc.

// 2. Account Deletion
// src/app/api/user/delete/route.ts
// - Mark user as deleted
// - Delete all associated data
// - Remove from Stripe
// - Send confirmation email

// 3. Privacy Policy
// src/app/privacy/page.tsx

// 4. Terms of Service
// src/app/terms/page.tsx
```

### 7.7 Password Security

```typescript
// Vérifier que déjà en place:
// ✅ Bcrypt hashing (line 10 dans auth.ts)
// ✅ Min 8 chars dans validations
// ✅ No password in logs

// Ajouter:
// ❌ Password reset flow
// ❌ 2FA (optional, Phase 3)
// ❌ Password history (no reuse)
```

---

## 8️⃣ MONITORING & ANALYTICS - SEMAINE 10

### 8.1 Sentry Integration (Error Tracking)

```bash
npm install @sentry/nextjs
```

```typescript
// src/sentry.client.config.ts & src/sentry.server.config.ts

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// Auto-captures:
// - Unhandled exceptions
// - Performance issues
// - Session replays on error
// - API errors
```

### 8.2 Analytics (Tracking)

```bash
npm install posthog # ou Mixpanel, Plausible
```

```typescript
// src/providers/AnalyticsProvider.tsx

Key events to track:
- signup
- login
- create_product
- create_listing
- create_order
- fulfill_order
- upgrade_plan
- downgrade_plan
- api_error
- webhook_error
```

### 8.3 Logs Management

```typescript
// src/lib/logger.ts

// Structured logging:
// [timestamp] [level] [service] [userId] [workspaceId] message
// Example:
// 2024-01-01 10:00:00 INFO ProductService user123 ws456 Created product

// Send to external service:
// - Datadog, New Relic, CloudWatch, Loggly
```

---

## 9️⃣ TESTING - SEMAINE 11

### 9.1 Unit Tests

```bash
npm install --save-dev jest @testing-library/react
```

```typescript
// Test priorités:
// 1. Services (ProductService, OrderService, etc)
// 2. Utility functions
// 3. Important components

// src/services/ProductService.test.ts
// src/services/OrderService.test.ts
// src/lib/utils.test.ts
```

### 9.2 Integration Tests

```bash
npm install --save-dev @playwright/test
```

```typescript
// Test flows end-to-end:
// 1. Signup + plan selection + payment
// 2. Create product + create listing
// 3. Create order + fulfill order
// 4. Change subscription plan
```

### 9.3 Performance Testing

```
- Page load time < 2s
- API response < 200ms
- Database query < 100ms
- Upload size < 10s
```

---

## 🔟 LAUNCH PREPARATION - SEMAINE 11-12

### 10.1 Pre-Launch Checklist

```
Code Quality:
☐ No console.logs in production
☐ Error boundaries on all pages
☐ Loading states for all async
☐ Proper error messages to users
☐ Mobile responsive tested
☐ Accessibility audit (WCAG 2.1 AA)

Performance:
☐ Lighthouse score > 90
☐ Core Web Vitals optimized
☐ Images optimized
☐ Code splitting in place
☐ Database indexes created

Security:
☐ Environment variables secure
☐ Secrets not in code
☐ HTTPS forced
☐ Rate limiting active
☐ Webhook signatures validated
☐ API keys protected

Operations:
☐ Database backups scheduled
☐ Monitoring + alerts set up
☐ Logging centralized
☐ Incident response plan
☐ Runbooks created
☐ Team trained on ops

Business:
☐ Terms of Service reviewed
☐ Privacy Policy updated
☐ GDPR compliant
☐ Stripe production keys
☐ Email templates ready
☐ Support system set up
```

### 10.2 Deployment Strategy

```
Week 1: Internal Staging
- Deploy to staging environment
- Full testing
- Load testing
- Security audit

Week 2: Beta Release
- 100 invited users
- Monitor for bugs
- Collect feedback
- Fix critical issues

Week 3: Public Launch
- Open to everyone
- Monitor closely
- Have support ready
- Be prepared to rollback

Post-Launch:
- Daily monitoring
- Quick bug fixes
- Gather feedback
- Plan Phase 3
```

### 10.3 Success Metrics

```
First Month:
- 100+ signups
- 5% conversion to paid
- < 1% churn
- < 5% error rate
- API uptime > 99.5%

First Quarter:
- 500+ signups
- 10% conversion to paid
- MRR > €500
- < 10% churn
- 98% satisfaction
```

---

## 📊 RÉSUMÉ PHASE 2

| Area | Status | Effort | Impact |
|---|---|---|---|
| UI/UX | ❌ START | 1-2w | 🔴 Critical |
| Payments | ❌ START | 1-2w | 🔴 Revenue |
| Storage | ❌ START | 1w | 🟡 Important |
| eBay API | ❌ START | 1w | 🟡 Important |
| Etsy API | ❌ START | 1w | 🟡 Important |
| Fulfillment Prep | ⚠️ PARTIAL | 1w | 🟡 Important |
| Admin Dashboard | ❌ START | 2w | 🟡 Important |
| Security | ⚠️ PARTIAL | 1w | 🔴 Critical |
| Testing | ❌ START | 1w | 🟡 Important |
| Launch Prep | ❌ START | 1w | 🔴 Critical |

**Total Effort**: 10-12 weeks (1 developer full-time or 2 developers part-time)

**Estimated Cost**: €15,000-30,000 (dev time, Stripe fees, infrastructure)

**Revenue Potential**: €1,000-5,000 MRR after launch

---

## 🚀 NEXT STEPS

1. **THIS WEEK**: Finish audit fixes (done ✅)
2. **NEXT WEEK**: Start Phase 2 with UI/UX
3. **WEEK 3**: Integrate Stripe
4. **WEEK 4**: Add marketplace APIs
5. **WEEK 10**: Internal testing
6. **WEEK 12**: Public launch

Ready to proceed? Let me know which area to start first!
