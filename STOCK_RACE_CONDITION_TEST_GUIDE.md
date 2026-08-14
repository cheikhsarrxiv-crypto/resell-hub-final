# 🧪 STOCK RACE CONDITION — TEST GUIDE

**Status**: Code ready, migration ready, test pending

---

## Setup Required

### 1. Apply PostgreSQL Migration

```bash
# This creates:
# - reserve_product_stock() function with row locking
# - CHECK constraint for non-negative stock
# - Index for faster lookups

npm run db:push
```

### 2. Verify Migration Applied

```bash
# Connect to PostgreSQL
psql YOUR_DATABASE_URL

# Check function exists
SELECT proname FROM pg_proc WHERE proname = 'reserve_product_stock';

# Check constraint exists
\d "Product"

# Should see: CHECK (quantity >= 0)
```

---

## Running the Test

### Method 1: Automated Test Suite (Recommended)

```bash
# Run with Jest/Vitest
npm test -- stock-race-condition.test.ts

# Expected output:
# ✓ Stock race condition fixed (7/7 tests pass)
# ✓ Exactly one order succeeds
# ✓ Stock never goes negative
# ✓ Multiple attempts handled correctly
```

### Method 2: Manual API Test

```bash
# 1. Setup test data
curl -X POST http://localhost:3000/api/test/stock-race-condition \
  -H "Content-Type: application/json" \
  -d '{"action":"setup"}'

# Response:
# {
#   "workspaceId": "ws_xxx",
#   "productId": "prod_yyy",
#   "initialStock": 1
# }

# 2. Simulate concurrent orders
curl -X POST http://localhost:3000/api/test/stock-race-condition \
  -H "Content-Type: application/json" \
  -d '{
#   "action":"simulate",
#   "productId":"prod_yyy",
#   "workspaceId":"ws_xxx",
#   "attempts":2
# }'

# Response:
# {
#   "attempts": 2,
#   "results": [
#     {"attempt": 1, "success": true, "message": "Stock reserved"},
#     {"attempt": 2, "success": false, "message": "Insufficient stock"}
#   ],
#   "successCount": 1,
#   "finalStock": 0,
#   "raceConditionFixed": true
# }

# 3. Cleanup
curl -X POST http://localhost:3000/api/test/stock-race-condition \
  -H "Content-Type: application/json" \
  -d '{
#   "action":"cleanup",
#   "workspaceId":"ws_xxx"
# }'
```

---

## Test Scenarios

### Scenario 1: Two Simultaneous Orders (Stock = 1)
```
Initial: stock = 1
Order A: Reserve 1 unit
Order B: Reserve 1 unit (concurrent)

Expected:
- Order A: ✓ SUCCESS
- Order B: ✗ FAILED (insufficient stock)
- Final stock: 0
```

### Scenario 2: Five Concurrent Attempts (Stock = 1)
```
Initial: stock = 1
Orders: 5 simultaneous attempts to reserve 1 unit

Expected:
- 1 succeeds
- 4 fail
- Final stock: 0
- No negative values
```

### Scenario 3: Stock Release
```
Initial: stock = 0 (after order)
Release: 1 unit (cancel order)

Expected:
- Stock increases back to 1
```

---

## How It Works

### PostgreSQL Function (Atomic)
```sql
CREATE OR REPLACE FUNCTION reserve_product_stock(
  p_product_id TEXT,
  p_quantity INT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  new_quantity INT
)
AS $$
  -- Locks the row with FOR UPDATE
  -- Prevents other transactions from modifying until lock released
  -- Ensures only one transaction can update stock at a time
$$
```

### Isolation Guarantees
1. **Row Locking**: `SELECT FOR UPDATE` prevents concurrent modifications
2. **Check Constraint**: Database enforces `quantity >= 0`
3. **Transaction**: Atomic check-then-update
4. **Result**: No race conditions possible

---

## Expected Test Results

| Test Case | Status | Details |
|-----------|--------|---------|
| Single reservation | ✓ PASS | Stock decreases by 1 |
| Concurrent (2) | ✓ PASS | 1 succeeds, 1 fails |
| Concurrent (5) | ✓ PASS | 1 succeeds, 4 fail |
| Stock never negative | ✓ PASS | CHECK constraint enforced |
| Stock release | ✓ PASS | Stock increases correctly |

---

## Troubleshooting

### Issue: `reserve_product_stock function not found`
**Solution**: Migration not applied
```bash
npm run db:push
```

### Issue: "Insufficient stock" on first attempt
**Solution**: Product has qty=0, reset:
```bash
# In test:
Reset to qty=1 before test
```

### Issue: Both orders succeed (RACE CONDITION NOT FIXED)
**Solution**: PostgreSQL version too old or missing FOR UPDATE
- Requires PostgreSQL 9.1+ (supports FOR UPDATE)
- Check: `SELECT version();`

---

## Production Verification Checklist

- [ ] Migration applied successfully
- [ ] Function `reserve_product_stock` exists in DB
- [ ] CHECK constraint on `quantity >= 0` exists
- [ ] Concurrent test: 2 attempts → 1 success
- [ ] Concurrent test: 5 attempts → 1 success
- [ ] Stock never negative after any test
- [ ] Stock release works correctly
- [ ] No double-booking possible

