-- AI Agent Personalization V1 — adds a single new table, AgentProfile,
-- storing a reseller's self-declared, general preferences for the AI
-- Agent (never a constraint — see AiAgentService.buildSystemPrompt and
-- src/lib/ai/agentProfile.ts). Purely additive: no existing table is
-- altered. 1:1-optional on Workspace, same shape as OnboardingData.
--
-- NOT applied to any database from this environment (no network route to
-- the project's Postgres instance here — `prisma migrate diff`/`migrate
-- dev` both require live DB access this sandbox does not have, so this
-- file was prepared by hand, following this repo's own established
-- migration SQL conventions exactly). Prepared for review and for
-- `prisma migrate deploy` to be run manually against a local/dev
-- database, and only against production after separate, explicit
-- authorization. Not yet applied anywhere; must stay unapplied until
-- that authorization is given.

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id"                  TEXT NOT NULL,
    "workspaceId"         TEXT NOT NULL,
    "usageType"           TEXT NOT NULL,
    "budgetRange"         TEXT,
    "customBudgetEur"     DOUBLE PRECISION,
    "sellingPlatforms"    TEXT[],
    "preferredCategories" TEXT[],
    "monthlyGoal"         TEXT,
    "priority"            TEXT,
    "qualityVsPrice"      TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- (the single unique index below also serves every workspaceId lookup —
-- no separate, redundant plain index, same as OnboardingData's own
-- workspaceId @unique with no @@index([workspaceId]) alongside it)
CREATE UNIQUE INDEX "AgentProfile_workspaceId_key" ON "AgentProfile"("workspaceId");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
