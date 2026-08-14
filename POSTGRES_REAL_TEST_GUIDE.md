# 🗄️ PostgreSQL REAL TEST GUIDE

**Status**: Ready to test (needs running PostgreSQL instance)

---

## What's Ready

### Migrations Created
- ✅ `prisma/migrations/stock_race_fix/migration.sql` — Stock race condition fix
- ✅ `prisma/migrations/email_verification/migration.sql` — Email verification

### Code Ready
- ✅ `src/services/StockService.ts` — Stock operations
- ✅ PostgreSQL function: `reserve_product_stock()`

---

## Test Scenario 1: Stock Race Condition

### Setup
```bash
# 1. Start PostgreSQL
docker run -d \
  --name postgres-test \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=resellhub_test \
  -p 5432:5432 \
  postgres:15

# 2. Connect app to PostgreSQL
DATABASE_URL="postgresql://postgres:testpass@localhost:5432/resellhub_test"

# 3. Apply migrations
npm run db:push

# 4. Create test product
npx prisma db push -- \
  'INSERT INTO "Product" (id, workspaceId, title, quantity) VALUES (?, ?, ?, ?)'
```

### Test: 2 Concurrent Requests

```sql
-- Terminal 1: Begin transaction
BEGIN;
SELECT quantity FROM "Product" WHERE id = 'prod-test' FOR UPDATE;
-- Shows: quantity = 1

-- Terminal 2: Try to reserve (should wait for lock)
BEGIN;
SELECT quantity FROM "Product" WHERE id = 'prod-test' FOR UPDATE;
-- WAITS here (blocked by Terminal 1's lock)

-- Terminal 1: Reserve and commit
UPDATE "Product" SET quantity = 0 WHERE id = 'prod-test';
COMMIT;

-- Terminal 2: Now gets lock, tries to read
-- Shows: quantity = 0
UPDATE "Product" SET quantity = -1 WHERE id = 'prod-test';
-- ERROR: CHECK constraint violated (quantity >= 0)
ROLLBACK;

-- Final verification
SELECT quantity FROM "Product" WHERE id = 'prod-test';
-- Result: 0 (never went negative)
```

### Expected Results
```
✓ Terminal 1: Succeeds (quantity 1 → 0)
✓ Terminal 2: Fails (CHECK constraint)
✓ Final stock: 0 (never negative)
✓ Transaction isolation: WORKING
```

---

## Test Scenario 2: 5 Concurrent Requests (1 stock)

```javascript
// Node.js script to simulate concurrent requests
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function reserveStock(userId, attempt) {
  try {
    const result = await prisma.$queryRaw`
      SELECT * FROM reserve_product_stock(
        'prod-test',
        1,
        'ws-test'
      )
    `;
    return { userId, attempt, success: result[0]?.success };
  } catch (error) {
    return { userId, attempt, success: false, error: error.message };
  }
}

async function runConcurrentTest() {
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(reserveStock(`user-${i}`, i));
  }
  
  const results = await Promise.all(promises);
  return results;
}

runConcurrentTest().then(results => {
  console.log(JSON.stringify(results, null, 2));
  const successes = results.filter(r => r.success).length;
  console.log(`\nSuccesses: ${successes}/5`);
  console.log(`Expected: 1 success (1 stock), 4 failures`);
});
```

---

## Test Scenario 3: Email Verification Migration

```bash
# Apply email verification migration
npm run db:push

# Create test user
INSERT INTO "User" (id, email, emailVerified)
VALUES ('test-user-1', 'test@example.com', false);

# Generate verification token
INSERT INTO "EmailVerificationToken" (userId, hashedToken, expiresAt)
VALUES (
  'test-user-1',
  'abc123def456...',
  NOW() + INTERVAL '24 hours'
);

# Verify token works
SELECT * FROM "EmailVerificationToken" WHERE userId = 'test-user-1';

# Mark user as verified
UPDATE "User" SET emailVerified = true WHERE id = 'test-user-1';

# Verify result
SELECT email, emailVerified FROM "User" WHERE id = 'test-user-1';
-- Result: email=test@example.com, emailVerified=true
```

---

## Blocking Issues

**No PostgreSQL Running**:
```
Cannot perform these tests without a running PostgreSQL instance.
Needs:
- PostgreSQL 14+ running
- DATABASE_URL configured
- All migrations applied
```

---

## How to Run Full Test

```bash
# 1. Start PostgreSQL
docker run -d --name postgres-test \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=resellhub_test \
  -p 5432:5432 \
  postgres:15

# 2. Set database URL
export DATABASE_URL="postgresql://postgres:testpass@localhost:5432/resellhub_test"

# 3. Run migrations
npm run db:push

# 4. Create test script
cat > test-postgres.js << 'EOF'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  // Test 1: Stock race condition
  console.log('Test 1: Stock race condition...');
  
  // Create product
  await prisma.product.create({
    data: {
      id: 'prod-race-1',
      workspaceId: 'ws-test',
      title: 'Test Product',
      quantity: 1
    }
  });
  
  // Try 2 concurrent reserves
  const p1 = prisma.$queryRaw`SELECT * FROM reserve_product_stock('prod-race-1', 1, 'ws-test')`;
  const p2 = prisma.$queryRaw`SELECT * FROM reserve_product_stock('prod-race-1', 1, 'ws-test')`;
  
  const [r1, r2] = await Promise.all([p1, p2]);
  
  console.log('Result 1:', r1[0]);
  console.log('Result 2:', r2[0]);
  
  const final = await prisma.product.findUnique({
    where: { id: 'prod-race-1' }
  });
  
  console.log('Final stock:', final.quantity);
  console.log('Expected: 1 success, 1 failure, stock = 0');
}

test().then(() => process.exit(0));
EOF

# 5. Run test
node test-postgres.js
```

---

## Status

**Code**: ✅ READY
**Migrations**: ✅ CREATED
**Database**: ❌ NOT RUNNING (needs docker/setup)

**Result**: BLOCKED — POSTGRES INSTANCE REQUIRED

