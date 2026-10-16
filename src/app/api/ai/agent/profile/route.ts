/**
 * GET/PUT /api/ai/agent/profile
 *
 * AI Agent Personalization V1 — reads and persists a workspace's
 * AgentProfile (see prisma/schema.prisma and src/lib/ai/agentProfile.ts).
 * Same auth/workspace/aiAssistant gate as /api/ai/agent itself (not the
 * lighter gate /api/ai/agent/usage uses — this endpoint writes real
 * Agent configuration, not just reading a usage snapshot).
 *
 * SECURITY: workspaceId is derived exclusively from the authenticated
 * session (session.user.workspaceId, re-verified via verifyWorkspaceAccess
 * against the database) — never accepted from the request body/query as a
 * source of authorization. No new authorization mechanism — reuses
 * verifyWorkspaceAccess exactly like every other workspace-scoped route.
 *
 * profile: null is a normal, valid response (no AgentProfile row yet) —
 * never an error. The frontend's onboarding decision is based entirely
 * on this.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyWorkspaceAccess } from '@/lib/security';
import { SubscriptionService } from '@/services/SubscriptionService';
import { prisma } from '@/lib/prisma';
import { agentProfileInputSchema, type AgentProfileRecord } from '@/lib/ai/agentProfile';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-agent-profile-route');

export const dynamic = 'force-dynamic';

async function resolveWorkspaceId(): Promise<string | NextResponse> {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (!session.user.workspaceId) {
    return NextResponse.json({ error: 'No workspace found for this account', code: 'NO_WORKSPACE' }, { status: 403 });
  }

  const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId);

  const hasAgentAccess = await SubscriptionService.hasFeature(workspaceId, 'aiAssistant');
  if (!hasAgentAccess) {
    return NextResponse.json(
      { error: 'The AI Agent is not enabled for this workspace. Contact support if you believe this is an error.', code: 'FEATURE_DISABLED' },
      { status: 403 }
    );
  }

  return workspaceId;
}

/**
 * Diagnostic fix (profile 403 vs agent-search 500 investigation) — a
 * stable, machine-readable `code` alongside every non-2xx JSON body this
 * route returns, so AgentPage's frontend never has to guess the cause
 * from the human-readable `error` string (and used to not even try,
 * silently treating any non-ok response as "no profile yet" — see
 * interpretProfileResponse in agentConversation.ts, the consumer this
 * was added for).
 *
 * Every HTTP status below is UNCHANGED from before this fix — only the
 * `code` field is new, which is purely additive for any existing
 * consumer that only reads `error`/`success`/`profile`. Deliberately
 * NOT routed through the shared errorResponse() (src/lib/security.ts):
 * that helper is used by many other routes with no `code` field at all,
 * and giving it one here would change its shape for all of them. This
 * local mapper instead mirrors errorResponse()'s own existing message ->
 * status precedence exactly (same branches, same order), just attaching
 * a `code` on top — never changes which status a given error message
 * maps to.
 */
function profileErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Internal server error';

  if (message === 'Unauthorized' || message.includes('unauthorized')) {
    return NextResponse.json({ error: message, code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (message === 'Email verification required') {
    return NextResponse.json({ error: message, code: 'EMAIL_UNVERIFIED' }, { status: 403 });
  }
  if (message.includes('not found')) {
    return NextResponse.json({ error: message, code: 'NOT_FOUND' }, { status: 404 });
  }
  if (message.includes('required')) {
    return NextResponse.json({ error: message, code: 'INVALID_REQUEST' }, { status: 400 });
  }
  return NextResponse.json({ error: message, code: 'SERVER_ERROR' }, { status: 500 });
}

function toRecord(row: { usageType: string; budgetRange: string | null; customBudgetEur: number | null; sellingPlatforms: string[]; preferredCategories: string[]; monthlyGoal: string | null; priority: string | null; qualityVsPrice: string | null }): AgentProfileRecord {
  return {
    usageType: row.usageType,
    budgetRange: row.budgetRange,
    customBudgetEur: row.customBudgetEur,
    sellingPlatforms: row.sellingPlatforms,
    preferredCategories: row.preferredCategories,
    monthlyGoal: row.monthlyGoal,
    priority: row.priority,
    qualityVsPrice: row.qualityVsPrice,
  };
}

export async function GET() {
  try {
    const resolved = await resolveWorkspaceId();
    if (resolved instanceof NextResponse) return resolved;
    const workspaceId = resolved;

    const row = await prisma.agentProfile.findUnique({ where: { workspaceId } });

    return NextResponse.json({ success: true, profile: row ? toRecord(row) : null });
  } catch (error) {
    logger.error('AI agent profile lookup failed', error instanceof Error ? error : String(error));
    return profileErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolved = await resolveWorkspaceId();
    if (resolved instanceof NextResponse) return resolved;
    const workspaceId = resolved;

    const body = await request.json().catch(() => null);
    const result = agentProfileInputSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({ error: 'Invalid input', details: result.error.errors }, { status: 400 });
    }

    const data = result.data;
    const row = await prisma.agentProfile.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        usageType: data.usageType,
        budgetRange: data.budgetRange,
        customBudgetEur: data.customBudgetEur,
        sellingPlatforms: data.sellingPlatforms ?? [],
        preferredCategories: data.preferredCategories ?? [],
        monthlyGoal: data.monthlyGoal,
        priority: data.priority,
        qualityVsPrice: data.qualityVsPrice,
      },
      update: {
        usageType: data.usageType,
        budgetRange: data.budgetRange ?? null,
        customBudgetEur: data.customBudgetEur ?? null,
        sellingPlatforms: data.sellingPlatforms ?? [],
        preferredCategories: data.preferredCategories ?? [],
        monthlyGoal: data.monthlyGoal ?? null,
        priority: data.priority ?? null,
        qualityVsPrice: data.qualityVsPrice ?? null,
      },
    });

    return NextResponse.json({ success: true, profile: toRecord(row) });
  } catch (error) {
    logger.error('AI agent profile save failed', error instanceof Error ? error : String(error));
    return profileErrorResponse(error);
  }
}
