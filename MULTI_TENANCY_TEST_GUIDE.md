# 🔐 MULTI-TENANCY ISOLATION — TEST GUIDE

**Status**: Code tests ready, API-level testing required

---

## Overview

Multi-tenancy isolation verification:
- User A cannot access User B data
- All resources filtered by workspaceId
- API routes enforce workspace ownership

---

## Setup

### Automated Tests

```bash
# Unit tests (Prisma queries)
npm test -- multi-tenancy-isolation.test.ts

# Expected output:
# ✓ User A cannot read Product B
# ✓ User A cannot modify Product B
# ✓ User A cannot access Product B images
# ✓ User A can read own products
# ✓ Subscription isolation verified
# 5/5 tests pass
```

### Manual API Tests

```bash
# 1. Create Workspace A and User A
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user-a@example.com",
    "password": "password123"
  }'

# Response includes auth token for User A

# 2. Login as User A to get token
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user-a@example.com",
    "password": "password123"
  }'

# Save USER_A_TOKEN from response

# 3. Create product in Workspace A
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_A_TOKEN" \
  -d '{
    "title": "Product A",
    "sku": "PROD-A-001",
    "quantity": 10,
    "purchasePrice": 5,
    "sellingPrice": 15
  }'

# Save PRODUCT_A_ID from response

# 4. Create Workspace B and User B (repeat steps 1-3)
# Save USER_B_TOKEN and PRODUCT_B_ID

# 5. TEST: User A tries to access Product B
curl -H "Authorization: Bearer USER_A_TOKEN" \
  http://localhost:3000/api/products/PRODUCT_B_ID

# Expected response: 403 Forbidden or 404 Not Found
# NOT: 200 with product data

# 6. TEST: User A tries to modify Product B
curl -X PATCH http://localhost:3000/api/products/PRODUCT_B_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_A_TOKEN" \
  -d '{
    "title": "Hacked Product"
  }'

# Expected: 403 Forbidden or 404 Not Found

# 7. TEST: User A can access their own product
curl -H "Authorization: Bearer USER_A_TOKEN" \
  http://localhost:3000/api/products/PRODUCT_A_ID

# Expected: 200 with product data
```

---

## Test Coverage Matrix

| Resource | Read | Create | Update | Delete | User A → B |
|----------|------|--------|--------|--------|-----------|
| Products | ✓ | ✓ | ✓ | ✓ | ✗ (403) |
| Images | ✓ | ✓ | ✓ | ✓ | ✗ (403) |
| Orders | ✓ | ✓ | - | - | ✗ (403) |
| Listings | ✓ | ✓ | ✓ | ✓ | ✗ (403) |
| Subscriptions | ✓ | - | - | - | ✗ (403) |
| Settings | ✓ | - | ✓ | - | ✗ (403) |
| Analytics | ✓ | - | - | - | ✗ (403) |

---

## Isolation Points

### Database Layer ✓
- All queries include `workspaceId` filter
- Foreign keys to workspace configured
- Prisma relations enforce isolation

### API Layer ✓
- `getVerifiedWorkspaceId()` on all routes
- `verifyProductAccess()` for product operations
- Workspace ID extracted from JWT token

### Frontend Layer ✓
- useWorkspace() hook provides workspace context
- No cross-workspace navigation
- Session tied to workspace

---

## Security Checks

### 1. Direct ID Access (No Workspace Filter)
```bash
# Can User A access Product B via direct ID?
curl -H "Authorization: Bearer USER_A_TOKEN" \
  http://localhost:3000/api/products/prod_from_workspace_b

# Expected: Should fail in API route
# Even if DB query returns data, API layer must filter
```

### 2. Token Manipulation
```bash
# Can User A use User B's token?
# (This tests NextAuth verification)

# Try with USER_B_TOKEN as USER_A
curl -H "Authorization: Bearer USER_B_TOKEN" \
  http://localhost:3000/api/products

# Expected: Returns User B's products (not A's)
# Each user/workspace pair must be isolated
```

### 3. Subscription Isolation
```bash
# Create subscription for User A
curl -X POST http://localhost:3000/api/subscriptions \
  -H "Authorization: Bearer USER_A_TOKEN" \
  -d '{"planId": "starter"}'

# Can User B see User A's subscription?
curl -H "Authorization: Bearer USER_B_TOKEN" \
  http://localhost:3000/api/subscriptions

# Expected: Shows only User B's subscriptions
```

---

## Expected Results

### PASS Criteria
- [ ] User A cannot read User B's products
- [ ] User A cannot modify User B's products
- [ ] User A cannot delete User B's products
- [ ] User A cannot access User B's images
- [ ] User A cannot create orders for User B's products
- [ ] User A cannot see User B's subscriptions
- [ ] User A can fully manage own workspace
- [ ] Each workspace is completely isolated
- [ ] No cross-workspace data leakage

### FAIL = Security Breach
Any of the above failing means multi-tenancy isolation is broken.

---

## Automated Test Results

Test file: `/tests/multi-tenancy-isolation.test.ts`

Verifies:
1. Two workspaces created independently
2. Products created in respective workspaces
3. User A queries with workspace A context
4. User B queries with workspace B context
5. Cross-workspace access attempts fail
6. Self-access requests succeed

---

## Production Checklist

- [ ] All API routes validated with dual-workspace setup
- [ ] No workspaceId found in URL (always in token/context)
- [ ] Workspace ID extracted from authenticated session
- [ ] All queries include workspaceId filter
- [ ] Test with 2+ concurrent users
- [ ] Verify subscription isolation
- [ ] Verify image isolation
- [ ] Verify order isolation
- [ ] No data leakage in error messages
- [ ] Rate limiting doesn't leak workspace info

---

## Troubleshooting

### Issue: User A can read User B's data
**Severity**: CRITICAL - Security breach

**Diagnosis**:
```bash
# Check database query
# Is workspaceId included in WHERE clause?

# Check API route
# Does verifyProductAccess() check ownership?

# Check token
# Is workspaceId correctly extracted?
```

### Issue: Cross-workspace requests don't return 403
**Severity**: HIGH - Should fail earlier

**Solution**:
- API route must explicitly check workspace match
- Return 403 (Forbidden) not 404 (Not Found)
  - Better for security (don't leak existence)
  - Better UX (user knows they don't have access)

### Issue: Concurrent users interfere
**Severity**: HIGH - Race condition or session issue

**Solution**:
- Each request must use correct JWT
- NextAuth session must be workspace-specific
- Rate limiter must not share state

