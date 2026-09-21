-- AiUsageService V1 — the commercial AI Units quota layer, strictly
-- separate from AgentAction (which tracks the propose/confirm/execute
-- pipeline, not billing) and from the rate limiter (infrastructure
-- protection, not a commercial budget). Purely additive: no existing
-- table is altered. Three new tables:
--
-- AiUsageEvent: append-only audit trail, one row per real consumption
-- attempt, deduplicated by the (workspaceId, idempotencyKey) UNIQUE
-- index — mirrors AgentAction.idempotencyKey's own proven pattern
-- exactly, so a retry or a concurrent double-confirmation can never be
-- double-counted.
--
-- AiUsagePeriod: one row per (workspace, real billing period), holding
-- the fast aggregate counter AiUsageService actually checks/increments,
-- atomically, via the same conditional-UPDATE pattern already proven by
-- ProductService.reserveInventory on Inventory.available.
--
-- WorkspaceAiOverride: at most one row per workspace, letting an
-- Enterprise workspace get a custom monthly AI Units budget without any
-- code change — a workspace with no row here simply uses its plan's
-- default.
--
-- NOT applied to any database from this environment (no network route to
-- the project's Postgres instance here). This file is prepared for
-- review and for `prisma migrate deploy` to be run manually against a
-- local/dev database, and only against production after separate,
-- explicit authorization. Migrations not yet applied in production must
-- stay unapplied until that authorization is given.

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "actionId" TEXT,
    "toolUseId" TEXT,
    "toolName" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "idempotencyKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsagePeriod" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "unitsConsumed" INTEGER NOT NULL DEFAULT 0,
    "unitsLimit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsagePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAiOverride" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "monthlyUnitsLimit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAiOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageEvent_workspaceId_periodStart_idx" ON "AiUsageEvent"("workspaceId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageEvent_workspaceId_idempotencyKey_key" ON "AiUsageEvent"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsagePeriod_workspaceId_periodStart_periodEnd_key" ON "AiUsagePeriod"("workspaceId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiOverride_workspaceId_key" ON "WorkspaceAiOverride"("workspaceId");

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsagePeriod" ADD CONSTRAINT "AiUsagePeriod_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAiOverride" ADD CONSTRAINT "WorkspaceAiOverride_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
