# 🏗️ PHASE 2.9.2 — MARKETPLACE CONNECTION ARCHITECTURE

**Date**: 12 August 2026  
**Phase**: 2.9.2 (Architecture Design)  
**Status**: ⏳ In Progress

---

## 🎯 OBJECTIVE

Build a clean, extensible architecture that allows adding eBay, Etsy, and future marketplaces without changing the core SaaS platform.

**Core Principle**: Core business logic never depends directly on any marketplace implementation.

---

## 🏛️ ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                      CORE SAASMIDDLEWARE                    │
│  (Orders, Inventory, Fulfillment, Subscriptions, etc)       │
└────────────────┬──────────────────────┬────────────────────┘
                 │                      │
        ┌────────▼────────┐    ┌────────▼────────┐
        │  Marketplace    │    │  Marketplace    │
        │   Interface     │    │   Interface     │
        │  (Abstract)     │    │  (Abstract)     │
        └────────┬────────┘    └────────┬────────┘
                 │                      │
    ┌────────────┴─────────┬────────────┴─────────┐
    │                      │                      │
┌───▼────────┐  ┌──────────▼────────┐  ┌─────────▼────┐
│ EbayAdapter│  │ EtsyAdapter       │  │ DepopAdapter │
│ (REAL)     │  │ (REAL)            │  │ (MOCK)       │
└────────────┘  └───────────────────┘  └──────────────┘

Vinted = NOT_SUPPORTED (no official API)
Depop = NOT_SUPPORTED initially (limited API, placeholder for future)
```

---

## 📦 CORE COMPONENTS

### 1. MarketplaceAdapter (Abstract Interface)

**Purpose**: Define contract that all marketplace implementations must fulfill

**Responsibilities**:
- Authentication (OAuth)
- Token management (refresh, expiry)
- Listing operations (create, read, update, delete)
- Order retrieval
- Inventory synchronization
- Webhook handling
- Rate limit management
- Error handling and normalization

**No Implementation**: This is interface only. No real API calls here.

---

### 2. MarketplaceConnection (Data Model)

**Purpose**: Store user's marketplace credentials and connection state

**Tracks**:
- OAuth tokens (encrypted)
- Refresh tokens (encrypted)
- Token expiry
- Connection status (connected, expired, failed)
- Last sync timestamp
- Rate limit state
- Error history

**Workspace Isolation**: Every connection belongs to exactly one Workspace. No cross-workspace access possible.

---

### 3. OAuth/TokenManager (Service)

**Purpose**: Handle OAuth flows, token refresh, secure credential storage

**Responsibilities**:
- Initiate OAuth flow (generate authorization URL)
- Exchange authorization code for tokens
- Store tokens encrypted
- Refresh expired tokens
- Verify token expiry
- Provide tokens to adapters
- Revoke connections
- Handle token expiry gracefully

**Security**:
- Tokens stored encrypted using `@node-rs/argon2` or similar
- Tokens never logged
- Tokens never returned in API responses
- Tokens cached in memory (short TTL)
- Rotation on refresh

---

### 4. MarketplaceSync (Service)

**Purpose**: Coordinate synchronization between marketplaces and ResellHub

**Types of Sync**:
- **Listing Sync**: Pull marketplace listings → ResellHub (or import)
- **Order Sync**: Poll marketplaces for new orders → create ResellHub orders
- **Inventory Sync**: Update marketplace inventory when ResellHub inventory changes
- **Status Sync**: Update order status when fulfillment status changes

**Idempotency**:
- All syncs are idempotent (same input → same result)
- Webhook events deduplicated using event ID + timestamp
- Sync operations logged with unique sync ID

---

### 5. WebhookManager (Service)

**Purpose**: Handle real-time events from marketplaces

**Webhook Types**:
- order.created → Create ResellHub order
- order.updated → Update order status
- listing.sold → Decrement inventory
- listing.updated → Log change
- inventory.low → Alert (optional)

**Webhook Security**:
- Signature verification (HMAC-SHA256)
- Event deduplication (prevent duplicate processing)
- Idempotency keys
- Workspace isolation
- Event logging

**Webhook Delivery**:
- Async processing (queue-based)
- Retry on failure (exponential backoff)
- Dead-letter queue for failed events
- Event logging for audit trail

---

### 6. RateLimitManager (Service)

**Purpose**: Respect marketplace rate limits

**Per-Marketplace Limits**:
- eBay: 114 requests/hour
- Etsy: 120 requests/minute
- Store in Redis (distributed across servers)

**Features**:
- Token bucket algorithm
- Automatic backoff
- Queue requests if approaching limit
- Alert if consistently hitting limit

---

### 7. RetrySystem (Service)

**Purpose**: Handle transient failures gracefully

**Retry Strategy**:
- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Max 5 retries
- Don't retry on auth errors (4xx)
- Do retry on network errors (timeout, 5xx)
- Jitter to prevent thundering herd

---

### 8. ErrorNormalizer (Service)

**Purpose**: Convert marketplace-specific errors to common format

**Example Mapping**:
```
eBay 429 (Rate Limit)       → RATE_LIMIT_EXCEEDED
Etsy 429 (Rate Limit)       → RATE_LIMIT_EXCEEDED
eBay 401 (Auth expired)     → AUTH_EXPIRED
Etsy 401 (Auth expired)     → AUTH_EXPIRED
eBay 400 (Invalid listing)  → VALIDATION_ERROR
Etsy 400 (Invalid listing)  → VALIDATION_ERROR
```

**Benefit**: Core business logic sees consistent error types across all marketplaces

---

### 9. StatusMapper (Service)

**Purpose**: Map marketplace-specific order statuses to ResellHub statuses

**Example Mapping**:
```
eBay:
  - INCOMPLETE → pending
  - IN_PROCESS → confirmed
  - FULFILLED → shipped
  - CANCELLED → cancelled

Etsy:
  - PAID → confirmed
  - PARTIALLY_FULFILLED → partial_shipped
  - FULFILLED → shipped
  - CANCELLED → cancelled
```

---

### 10. ConnectionHealthCheck (Service)

**Purpose**: Monitor marketplace connection status

**Checks**:
- Token not expired
- Recent successful API call
- Webhook endpoint responding
- No repeated errors
- Subscription active (if required)

**Status States**:
- CONNECTED: Everything working
- EXPIRING_SOON: Token expires in < 7 days
- EXPIRED: Token expired, needs refresh
- ERROR: Recent failures
- DISCONNECTED: User disconnected

---

### 11. SyncLogger (Service)

**Purpose**: Log all synchronization activity for audit trail

**Logged**:
- Sync start/end time
- Items synced (count)
- Errors encountered
- Last successful sync
- Next scheduled sync
- Sync duration

**Used For**:
- Debugging sync issues
- Audit trail
- Performance monitoring
- User-facing "Last synced at" timestamp

---

## 📊 DATA FLOW

### Listing Import Flow
```
1. User: "Connect eBay"
2. Redirect to eBay OAuth
3. eBay: Authorization code returned
4. TokenManager: Exchange code for tokens
5. TokenManager: Store encrypted tokens in MarketplaceConnection
6. EbayAdapter: Fetch all active listings
7. ListingService: Create/update ResellHub listings
8. UI: "Successfully imported 47 listings"
```

### Order Sync Flow (Webhook)
```
1. eBay order created
2. eBay webhook POST to /webhooks/ebay
3. WebhookManager: Verify signature
4. WebhookManager: Deduplicate (check if event_id already processed)
5. WebhookManager: Extract order details
6. EbayAdapter: Normalize order format
7. OrderService: Create ResellHub order
8. InventoryService: Decrement stock
9. FulfillmentService: Create fulfillment order
10. WebhookManager: Log successful processing
11. eBay: 200 OK (webhook delivery confirmed)
```

### Inventory Sync Flow (Background Job)
```
1. Scheduler: Every 5 minutes, trigger inventory sync
2. InventoryService: Get all products with active marketplace listings
3. For each product:
   a. Get current ResellHub quantity
   b. For each connected marketplace:
      - EbayAdapter: Update eBay listing quantity
      - EtsyAdapter: Update Etsy listing quantity
4. RateLimitManager: Respect rate limits
5. SyncLogger: Log results
6. On error: RetrySystem with exponential backoff
```

---

## 🔐 SECURITY ARCHITECTURE

### Token Storage

**NOT Plaintext**:
```typescript
// ❌ WRONG
marketplaceConnection.oauthToken = "ebay_v2h7h2k7..."
```

**Encrypted**:
```typescript
// ✅ RIGHT
const encrypted = await encryptToken(token, workspace.id)
marketplaceConnection.encryptedOauthToken = encrypted
```

**Decryption in Memory Only**:
```typescript
// ✅ RIGHT
const token = await decryptToken(
  connection.encryptedOauthToken,
  workspace.id
)
// Token used immediately
// Not stored in variable for logging
```

### Workspace Isolation

**Every Operation Checks Workspace**:
```typescript
// ❌ WRONG
const connection = await MarketplaceConnection.findById(id)

// ✅ RIGHT
const connection = await MarketplaceConnection.findByIdAndWorkspace(
  id,
  workspace.id
)
if (!connection) throw new UnauthorizedError()
```

### Webhook Security

**Signature Verification**:
```typescript
// All webhooks must verify HMAC-SHA256 signature
const expectedSignature = await createSignature(
  webhook.payload,
  marketplace.webhookSecret
)
if (expectedSignature !== webhook.signature) {
  throw new InvalidSignatureError()
}
```

**Deduplication**:
```typescript
// Check if this exact event already processed
const exists = await WebhookLog.findByEventId(event.id)
if (exists) return 200 // Already processed, skip
```

---

## 📈 ERROR HANDLING

### API Errors

```typescript
// Marketplace error → Normalized error → Business logic response

EbayApiError (429)
  ↓
RateLimitExceeded
  ↓
{ status: 429, message: "Rate limit exceeded. Retry at..." }

EbayApiError (401)
  ↓
AuthExpired
  ↓
{ status: 401, message: "Connection expired. Reconnect required." }

EbayApiError (400, "Invalid category")
  ↓
ValidationError
  ↓
{ status: 400, message: "Invalid listing: category not allowed" }
```

### Graceful Degradation

```typescript
// If eBay is down, ResellHub continues working

async function syncInventory() {
  try {
    await ebayAdapter.updateInventory(product)
  } catch (error) {
    if (isNetworkError(error)) {
      logger.warn("eBay sync failed, will retry later")
      return // Continue to next product
    }
    throw error // Only throw on non-recoverable errors
  }
}
```

---

## 🧪 ARCHITECTURE TESTS

All tests are isolated and don't call real APIs.

### Test 1: Workspace Isolation

```typescript
// Verify different workspaces can't access each other's connections

async function testWorkspaceIsolation() {
  const workspace1 = await createWorkspace()
  const workspace2 = await createWorkspace()

  const connection1 = await MarketplaceConnection.create({
    workspaceId: workspace1.id,
    marketplace: "ebay",
    oauthToken: "token1"
  })

  // Workspace 2 tries to access Workspace 1's connection
  const result = await MarketplaceConnection.findByIdAndWorkspace(
    connection1.id,
    workspace2.id
  )

  assert(result === null) // ✅ Workspace 2 can't access it
}
```

### Test 2: Adapter Isolation

```typescript
// Verify EbayAdapter can't access Etsy's tokens

async function testAdapterIsolation() {
  const connection = new MarketplaceConnection({
    marketplace: "etsy",
    encryptedToken: "encrypted_etsy_token"
  })

  const ebayAdapter = new EbayAdapter(connection)
  
  // EbayAdapter never has access to connection data
  // It only works through abstraction
}
```

### Test 3: No Tokens in API Response

```typescript
// Verify tokens never leaked in API responses

async function testNoTokensInResponse() {
  const connection = await getMarketplaceConnection(id)
  
  // This should fail - connection has tokens
  expect(connection.encryptedOauthToken).toBeDefined()
  
  // But when returned to client, tokens stripped
  const response = connection.toJSON()
  expect(response.encryptedOauthToken).toBeUndefined()
  expect(response.oauthToken).toBeUndefined()
}
```

### Test 4: Webhook Idempotency

```typescript
// Duplicate webhook → should not create duplicate order

async function testWebhookIdempotency() {
  const webhookPayload = {
    id: "event_123",
    order_id: "order_456"
  }

  // First webhook
  await handleWebhook(webhookPayload)
  let orders = await Order.findByMarketplaceId("order_456")
  assert(orders.length === 1)

  // Exact same webhook again
  await handleWebhook(webhookPayload)
  orders = await Order.findByMarketplaceId("order_456")
  assert(orders.length === 1) // ✅ Still 1, not 2
}
```

### Test 5: Error Normalization

```typescript
// Different marketplace errors → same normalized error

async function testErrorNormalization() {
  // Mock eBay returning 429
  const ebayError = { status: 429, code: "REQUEST_LIMIT_EXCEEDED" }
  const normalized1 = ErrorNormalizer.normalize(ebayError, "ebay")
  expect(normalized1.type).toBe("RATE_LIMIT_EXCEEDED")

  // Mock Etsy returning 429
  const etsyError = { status: 429, headers: { "retry-after": 60 } }
  const normalized2 = ErrorNormalizer.normalize(etsyError, "etsy")
  expect(normalized2.type).toBe("RATE_LIMIT_EXCEEDED") // ✅ Same

  // Core logic handles same error type
  expect(normalized1.type === normalized2.type).toBe(true)
}
```

### Test 6: Rate Limit Handling

```typescript
// Rate limiter prevents exceeding marketplace limits

async function testRateLimitHandling() {
  const limiter = new RateLimitManager("ebay", 114) // 114 req/hour

  // Make 114 requests
  for (let i = 0; i < 114; i++) {
    await limiter.checkLimit()
    // All succeed
  }

  // 115th request should fail or queue
  await expect(limiter.checkLimit()).rejects.toThrow("RATE_LIMIT_EXCEEDED")
}
```

### Test 7: Connection Expiry Handling

```typescript
// Expired connection triggers re-auth flow

async function testConnectionExpiry() {
  const connection = await getExpiredConnection()
  
  // Adapter detects expired token
  const adapter = new EbayAdapter(connection)
  
  try {
    await adapter.getListings()
  } catch (error) {
    expect(error.type).toBe("AUTH_EXPIRED")
    // ✅ Core logic knows to trigger re-auth
  }
}
```

---

## 🔄 SYNC FLOW DETAILS

### Listing Sync

```
ResellHub → Marketplace Listing

Status Mapping:
  ResellHub: active     → eBay: ACTIVE
  ResellHub: inactive   → eBay: ENDED
  ResellHub: delisted   → eBay: ENDED (no API call)

Quantity Mapping:
  ResellHub.quantity → eBay.quantity (exactly)
  
Price Mapping:
  ResellHub.price → eBay.price (exactly)

On Conflict (marketplace shows different quantity):
  → Log warning
  → Use ResellHub as source of truth
  → Update marketplace
```

### Order Sync

```
Marketplace Order → ResellHub Order

Status Mapping:
  eBay: INCOMPLETE         → ResellHub: pending
  eBay: IN_PROCESS         → ResellHub: confirmed
  eBay: FULFILLED          → ResellHub: shipped
  eBay: CANCELLED          → ResellHub: cancelled

On Conflict (order status mismatch):
  → Log warning
  → Don't auto-correct
  → Alert admin
```

---

## 📋 FILES TO CREATE

```
Phase 2.9.2 Architecture Files:

1. Marketplace Adapters
   src/services/marketplace/MarketplaceAdapter.ts
   src/services/marketplace/adapters/EbayAdapter.ts (SKELETON)
   src/services/marketplace/adapters/EtsyAdapter.ts (SKELETON)
   src/services/marketplace/adapters/DepopAdapter.ts (NOT_SUPPORTED stub)
   src/services/marketplace/adapters/VintedAdapter.ts (NOT_SUPPORTED stub)

2. Services
   src/services/marketplace/TokenManager.ts
   src/services/marketplace/MarketplaceSync.ts
   src/services/marketplace/WebhookManager.ts
   src/services/marketplace/RateLimitManager.ts
   src/services/marketplace/RetrySystem.ts
   src/services/marketplace/ErrorNormalizer.ts
   src/services/marketplace/StatusMapper.ts
   src/services/marketplace/ConnectionHealthCheck.ts
   src/services/marketplace/SyncLogger.ts

3. API Routes
   src/app/api/marketplace/connect/[marketplace]/route.ts
   src/app/api/marketplace/callback/[marketplace]/route.ts
   src/app/api/marketplace/disconnect/route.ts
   src/app/api/marketplace/connections/route.ts
   src/app/api/marketplace/status/route.ts
   src/app/api/marketplace/sync/route.ts
   src/app/api/webhooks/marketplace/route.ts

4. Database Models (Prisma)
   Update schema.prisma (MarketplaceConnection, WebhookLog, SyncLog)

5. Types & Interfaces
   src/types/marketplace.ts

6. Tests
   src/__tests__/marketplace/architecture.test.ts
   src/__tests__/marketplace/isolation.test.ts
   src/__tests__/marketplace/webhooks.test.ts
   src/__tests__/marketplace/errors.test.ts

7. Documentation
   PHASE_2_9_2_ARCHITECTURE_DESIGN.md (this file)
   MARKETPLACE_ADAPTER_GUIDE.md
   OAUTH_FLOW_GUIDE.md
   WEBHOOK_GUIDE.md
```

---

## ✅ ARCHITECTURE CHECKLIST

Before moving to 2.9.3 (eBay):

- [ ] MarketplaceAdapter interface defined
- [ ] EbayAdapter skeleton (no real calls)
- [ ] EtsyAdapter skeleton (no real calls)
- [ ] DepopAdapter marked NOT_SUPPORTED
- [ ] VintedAdapter marked NOT_SUPPORTED
- [ ] TokenManager service created
- [ ] Encryption/decryption working
- [ ] MarketplaceConnection database model
- [ ] OAuth routes created
- [ ] WebhookManager service
- [ ] ErrorNormalizer service
- [ ] StatusMapper service
- [ ] RateLimitManager service
- [ ] RetrySystem service
- [ ] Workspace isolation tests passing
- [ ] Token security tests passing
- [ ] Webhook idempotency tests passing
- [ ] Error normalization tests passing
- [ ] Documentation complete

---

## 🛑 CRITICAL RULES FOR PHASE 2.9.2

1. ✅ **No real API calls** — Use TEST MOCK or skip
2. ✅ **No credentials hardcoded** — All from .env
3. ✅ **Tokens never logged** — Can't appear in logs
4. ✅ **Workspace isolation enforced** — Every query checks workspace
5. ✅ **All adapters extend interface** — No direct dependencies
6. ✅ **Errors normalized** — Core logic doesn't know about marketplace specifics
7. ✅ **Tests document behavior** — Tests are contract
8. ✅ **No mocks in production** — TEST MOCK labeled clearly

---

## 📝 NEXT PHASE

**2.9.3**: eBay REAL Integration (only after 2.9.2 approved)

Will implement:
- OAuth flow with real eBay sandbox
- Real API calls (in sandbox)
- Actual token management
- Actual webhook testing

**Not in 2.9.2**:
- No eBay API calls
- No real credentials needed
- No real OAuth redirects
- No integration testing

---

**Architecture document complete. Ready for implementation.**

