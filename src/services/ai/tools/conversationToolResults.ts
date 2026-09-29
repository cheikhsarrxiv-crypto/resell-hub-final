import { prisma } from '@/lib/prisma';

/**
 * Phase 12B — reconstructs "which tool produced this result, and when"
 * from the SAME raw persistence AiAgentService.loadHistory already writes
 * (AgentMessage rows with role 'assistant'/'tool_result') — no new table,
 * no duplicated tool-call log. An 'assistant' row's own content is the
 * array of Anthropic content blocks for that turn (tool_use blocks carry
 * their own `name`); the matching 'tool_result' row's blocks only carry
 * `tool_use_id`, so the two are correlated by that id — exactly how
 * Anthropic's own protocol already links them.
 *
 * Used by generate_listing_draft/edit_listing_draft to revalidate a
 * sourceUrl/sourceItemId against what search_products (or a prior draft)
 * actually returned IN THIS CONVERSATION — never trusting the model's own
 * repetition of an id/url as proof it's real.
 */
export interface ConversationToolResultEntry {
  toolUseId: string;
  toolName: string;
  result: unknown;
  createdAt: Date;
}

/**
 * Phase 12C-Offline hardening: `workspaceId` is REQUIRED and checked
 * against AgentConversation.workspaceId before reading anything —
 * AgentMessage itself has no workspaceId column (only its parent
 * AgentConversation does), so without this check a caller holding any
 * valid conversationId string (even one belonging to a different
 * workspace) could read that conversation's tool results. In practice
 * conversationId is an unguessable cuid() and AiAgentService already
 * never hands a foreign workspace one — but this makes the isolation an
 * explicit, defense-in-depth guarantee of this function itself, not an
 * implicit property borrowed from callers never leaking the id.
 */
export async function findToolResultsByName(
  conversationId: string,
  toolNames: string[],
  workspaceId: string
): Promise<ConversationToolResultEntry[]> {
  const conversation = await prisma.agentConversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: { id: true },
  });
  if (!conversation) return [];

  const wanted = new Set(toolNames);
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId, role: { in: ['assistant', 'tool_result'] } },
    orderBy: { createdAt: 'asc' },
  });

  const nameByToolUseId = new Map<string, string>();
  for (const row of rows) {
    if (row.role !== 'assistant') continue;
    let blocks: unknown;
    try {
      blocks = JSON.parse(row.content);
    } catch {
      continue;
    }
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_use' &&
        typeof (block as any).id === 'string' &&
        typeof (block as any).name === 'string' &&
        wanted.has((block as any).name)
      ) {
        nameByToolUseId.set((block as any).id, (block as any).name);
      }
    }
  }

  const entries: ConversationToolResultEntry[] = [];
  for (const row of rows) {
    if (row.role !== 'tool_result') continue;
    let blocks: unknown;
    try {
      blocks = JSON.parse(row.content);
    } catch {
      continue;
    }
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      const toolUseId = block && typeof block === 'object' ? (block as any).tool_use_id : undefined;
      const toolName = typeof toolUseId === 'string' ? nameByToolUseId.get(toolUseId) : undefined;
      if (!toolName) continue;

      let result: unknown;
      try {
        result = JSON.parse((block as any).content);
      } catch {
        continue;
      }
      entries.push({ toolUseId, toolName, result, createdAt: row.createdAt });
    }
  }

  return entries;
}
