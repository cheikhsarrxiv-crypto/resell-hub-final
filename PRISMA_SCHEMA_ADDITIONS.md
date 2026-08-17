# Prisma Schema Additions for Marketplace Integration

Add the following models to your `schema.prisma` file:

```prisma
// ============================================================================
// MARKETPLACE CONNECTION
// ============================================================================
model MarketplaceConnection {
  id            String   @id @default(cuid())
  workspaceId   String
  marketplace   String   // "ebay" | "etsy" | "depop" | "vinted"
  
  // OAuth Credentials (encrypted)
  encryptedOauthToken    String    // Encrypted access token
  encryptedRefreshToken  String?   // Encrypted refresh token
  tokenExpiresAt         DateTime?
  
  // Seller Information
  sellerName    String?
  sellerId      String?
  accountEmail  String?
  
  // Connection Status
  status        String   @default("connected") // "connected" | "expired" | "error" | "disconnected"
  
  // Sync Tracking
  lastSyncAt    DateTime?
  lastSyncError String?
  lastApiCallAt DateTime?
  consecutiveErrors Int @default(0)
  
  // Metadata
  connectedAt   DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  // Relations
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  webhookLogs   WebhookLog[]
  syncLogs      SyncLog[]
  
  // Unique constraint: One connection per marketplace per workspace
  @@unique([workspaceId, marketplace])
  @@index([workspaceId])
  @@index([marketplace])
  @@index([status])
  @@index([lastSyncAt])
}

// ============================================================================
// WEBHOOK LOGS
// ============================================================================
model WebhookLog {
  id            String   @id @default(cuid())
  workspaceId   String
  marketplace   String   // "ebay" | "etsy"
  
  // Event Identification
  eventId       String   // Unique ID from marketplace
  eventType     String   // "order.created", "listing.sold", etc
  
  // Payload
  payload       String   // JSON stringified
  
  // Status
  status        String   @default("processing") // "processing" | "processed" | "failed"
  error         String?
  processedAt   DateTime?
  
  // Timestamps
  createdAt     DateTime  @default(now())
  
  // Relations
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connection    MarketplaceConnection? @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  connectionId  String?
  
  // Indexes for performance
  @@unique([workspaceId, marketplace, eventId]) // Prevent duplicates
  @@index([workspaceId])
  @@index([marketplace])
  @@index([eventId])
  @@index([status])
  @@index([createdAt])
}

// ============================================================================
// SYNC LOGS
// ============================================================================
model SyncLog {
  id              String   @id @default(cuid())
  workspaceId     String
  marketplace     String   // "ebay" | "etsy"
  syncType        String   // "listing" | "order" | "inventory" | "status"
  
  // Execution
  status          String   @default("pending") // "pending" | "in_progress" | "completed" | "failed"
  itemsProcessed  Int      @default(0)
  itemsFailed     Int      @default(0)
  error           String?
  
  // Timing
  startedAt       DateTime  @default(now())
  completedAt     DateTime?
  nextScheduledAt DateTime?
  
  // Relations
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connection      MarketplaceConnection? @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  connectionId    String?
  
  // Indexes
  @@index([workspaceId])
  @@index([marketplace])
  @@index([syncType])
  @@index([status])
  @@index([startedAt])
}
```

## Add to Workspace model:

```prisma
model Workspace {
  // ... existing fields ...
  
  marketplaceConnections MarketplaceConnection[]
  webhookLogs            WebhookLog[]
  syncLogs               SyncLog[]
}
```

## Run migration:

```bash
npx prisma migrate dev --name "add_marketplace_models"
```

