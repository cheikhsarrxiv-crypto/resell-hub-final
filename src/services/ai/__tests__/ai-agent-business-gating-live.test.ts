/**
 * Real-DB tests proving the AI Agent's Business-tier gate and its
 * workspace isolation are actually enforced against real data, not just
 * asserted by source inspection (see agent-route-security.test.ts for the
 * route-wiring-order checks, which can't hit a real DB the same way the
 * route imports next/server).
 *
 * Requires the new AgentConversation/AgentMessage tables (see
 * prisma/migrations/20260917120000_add_ai_agent_conversations) to exist
 * in whatever database this runs against — skipped entirely (like every
 * other *-live.test.ts in this repo) when no test database is reachable,
 * as is the case in this sandbox.
 */
import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SubscriptionService } from '@/services/SubscriptionService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';

async function ensurePlans() {
  const freeFields = {
    displayName: 'Free', price: 0,
    maxProducts: 10, maxListings: 20, maxOrders: 50, maxMarketplaces: 2, maxUsers: 1,
    aiAssistant: false,
  };
  const businessFields = {
    displayName: 'Business', price: 99,
    maxProducts: 5000, maxListings: 10000, maxOrders: 10000, maxMarketplaces: 4, maxUsers: 5,
    aiAssistant: true,
  };

  const [free, business] = await Promise.all([
    prisma.plan.upsert({ where: { name: 'free' }, update: freeFields, create: { name: 'free', ...freeFields } }),
    prisma.plan.upsert({ where: { name: 'business' }, update: businessFields, create: { name: 'business', ...businessFields } }),
  ]);
  return { free, business };
}

async function createWorkspaceOnPlan(planId: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await prisma.user.create({
    data: { email: `agent-gating-test-${suffix}@example.com`, name: 'Test User', password: 'x' },
  });
  const subscription = await prisma.subscription.create({ data: { planId, status: 'active' } });
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `agent-gating-test-${suffix}`, userId: user.id, subscriptionId: subscription.id },
  });
  return { user, workspace, subscription };
}

async function cleanup(ids: { userId: string; workspaceId: string; subscriptionId: string }) {
  await prisma.agentMessage.deleteMany({
    where: { conversation: { workspaceId: ids.workspaceId } },
  }).catch(() => {});
  await prisma.agentConversation.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {});
  await prisma.subscription.delete({ where: { id: ids.subscriptionId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('AI Agent Business gate — SubscriptionService.hasFeature("aiAssistant")', () => {
  it('is true for a workspace on the Business plan', async () => {
    const { business } = await ensurePlans();
    const { user, workspace, subscription } = await createWorkspaceOnPlan(business.id);

    try {
      const hasAccess = await SubscriptionService.hasFeature(workspace.id, 'aiAssistant');
      expect(hasAccess).toBe(true);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, subscriptionId: subscription.id });
    }
  });

  it('is false for a workspace on the Free plan', async () => {
    const { free } = await ensurePlans();
    const { user, workspace, subscription } = await createWorkspaceOnPlan(free.id);

    try {
      const hasAccess = await SubscriptionService.hasFeature(workspace.id, 'aiAssistant');
      expect(hasAccess).toBe(false);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, subscriptionId: subscription.id });
    }
  });
});

describe.skipIf(!dbAvailable)('AiAgentService — conversation isolation against real data', () => {
  it('a workspace can never continue another workspace\'s conversation', async () => {
    const { business } = await ensurePlans();
    const a = await createWorkspaceOnPlan(business.id);
    const b = await createWorkspaceOnPlan(business.id);

    try {
      const createMock = vi.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hi from A' }],
      });
      vi.doMock('@anthropic-ai/sdk', () => {
        class RateLimitError extends Error {}
        class MockAnthropic {
          messages = { create: createMock };
          constructor(_opts: { apiKey: string }) {}
        }
        (MockAnthropic as any).RateLimitError = RateLimitError;
        return { default: MockAnthropic };
      });
      const { AiAgentService } = await import('@/services/ai/AiAgentService');
      (AiAgentService as any).client = null;

      const turnA = await AiAgentService.sendMessage(a.workspace.id, a.user.id, 'hello', undefined);

      await expect(
        AiAgentService.sendMessage(b.workspace.id, b.user.id, 'let me see workspace A\'s conversation', turnA.conversationId)
      ).rejects.toThrow('Conversation not found in this workspace');
    } finally {
      await cleanup({ userId: a.user.id, workspaceId: a.workspace.id, subscriptionId: a.subscription.id });
      await cleanup({ userId: b.user.id, workspaceId: b.workspace.id, subscriptionId: b.subscription.id });
    }
  });
});
