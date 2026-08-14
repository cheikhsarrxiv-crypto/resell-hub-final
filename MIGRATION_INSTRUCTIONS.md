# Database Migration - add_marketplace_models

## Status
✅ **Migration SQL created and ready**
⏳ **Not yet executed** (requires DATABASE_URL)

## Prerequisites
Before executing this migration, ensure:

1. **Database Connection**
   ```bash
   # Set DATABASE_URL in .env.local
   DATABASE_URL="postgresql://user:password@localhost:5432/resellhub"
   ```

2. **Prisma Client Generated**
   ```bash
   npx prisma generate
   ```

3. **Backup Database** (recommended for production)
   ```bash
   pg_dump -h localhost -U user -d resellhub -f backup.sql
   ```

## Execute Migration

```bash
# Option 1: Interactive (recommended)
cd /home/claude/reselling-saas
npx prisma migrate dev --name "add_marketplace_models"

# Option 2: Deploy to production
npx prisma migrate deploy
```

## What This Migration Adds

### MarketplaceConnection Table Updates
- ✅ `encryptedOauthToken` (TEXT) - Encrypted OAuth access token
- ✅ `encryptedRefreshToken` (TEXT) - Encrypted refresh token
- ✅ `tokenExpiresAt` (TIMESTAMP) - Token expiration time
- ✅ `sellerName` (TEXT) - Seller account name
- ✅ `sellerId` (TEXT) - External seller ID
- ✅ `accountEmail` (TEXT) - Seller email
- ✅ `lastSyncAt` (TIMESTAMP) - Last successful sync time
- ✅ `lastSyncError` (TEXT) - Error message from last sync
- ✅ `lastApiCallAt` (TIMESTAMP) - Last API call timestamp
- ✅ `consecutiveErrors` (INTEGER) - Counter for retry logic

### New Tables
- ✅ `WebhookLog` - Event logging and deduplication
- ✅ `SyncLog` - Sync operation tracking

### Indexes
- ✅ MarketplaceConnection_status_idx
- ✅ MarketplaceConnection_lastSyncAt_idx
- ✅ WebhookLog_workspaceId_marketplace_eventId (UNIQUE)
- ✅ WebhookLog_status_idx
- ✅ SyncLog_workspaceId_idx
- ✅ SyncLog_status_idx

## Verification After Migration

```bash
# 1. Verify migration applied
npx prisma migrate status

# 2. Check Prisma schema is in sync
npx prisma validate

# 3. Verify database
psql -h localhost -U user -d resellhub -c "\dt"
psql -h localhost -U user -d resellhub -c "SELECT version();"

# 4. Test data access
npx prisma studio
```

## Rollback (if needed)

```bash
# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Or manually rollback specific migration
npx prisma migrate resolve --rolled-back add_marketplace_models
```

## Non-Destructive
✅ This migration uses `ALTER TABLE` and `CREATE TABLE`
✅ No existing data will be deleted
✅ All columns are nullable except `consecutiveErrors`
✅ Safe to apply to existing databases

MIGA

cat /home/claude/reselling-saas/MIGRATION_INSTRUCTIONS.md | head -40
