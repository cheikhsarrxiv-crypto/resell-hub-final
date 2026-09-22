-- Phase 12A — ADKSY AI Agent Action Framework. Adds a single new table,
-- AgentAction, backing the propose -> confirm -> execute state machine
-- for any tool categorized 'engage' (see AgentToolCategory in
-- src/services/ai/tools/types.ts). Purely additive: no existing table is
-- altered.
--
-- Workspace-scoped like every other Agent-related table — an action can
-- never be read, confirmed, cancelled, or executed across workspaces (see
-- AiActionService's own workspaceId-scoped queries and the
-- (workspaceId, idempotencyKey) unique index below).
--
-- NOT applied to any database from this environment (no network route to
-- the project's Postgres instance here). This file is prepared for
-- review and for `prisma migrate deploy` to be run manually against a
-- local/dev database, and only against production after separate,
-- explicit authorization. Migrations not yet applied in production must
-- stay unapplied until that authorization is given.

-- CreateTable
CREATE TABLE "AgentAction" (
    "id"                   TEXT NOT NULL,
    "workspaceId"          TEXT NOT NULL,
    "userId"               TEXT NOT NULL,
    "conversationId"       TEXT NOT NULL,
    "type"                 TEXT NOT NULL,
    "category"             TEXT NOT NULL,
    "status"               TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "input"                TEXT NOT NULL,
    "summary"              TEXT NOT NULL,
    "confirmationRequired" BOOLEAN NOT NULL DEFAULT true,
    "idempotencyKey"       TEXT NOT NULL,
    "result"               TEXT,
    "error"                TEXT,
    "expiresAt"            TIMESTAMP(3) NOT NULL,
    "confirmedAt"          TIMESTAMP(3),
    "executedAt"           TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_workspaceId_idempotencyKey_key" ON "AgentAction"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentAction_workspaceId_idx" ON "AgentAction"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentAction_conversationId_idx" ON "AgentAction"("conversationId");

-- CreateIndex
CREATE INDEX "AgentAction_status_idx" ON "AgentAction"("status");

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
