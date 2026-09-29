/**
 * Phase 12C-Offline — direct unit tests for findToolResultsByName's own
 * workspace-ownership check, isolated from the higher-level draft tools
 * that call it (see listingDraftTools.test.ts / actionTools.test.ts /
 * publish-listing-pipeline-integration.test.ts for those).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { agentConversationFindFirst, agentMessageFindMany } = vi.hoisted(() => ({
  agentConversationFindFirst: vi.fn(),
  agentMessageFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentConversation: { findFirst: agentConversationFindFirst },
    agentMessage: { findMany: agentMessageFindMany },
  },
}));

import { findToolResultsByName } from '@/services/ai/tools/conversationToolResults';

describe('findToolResultsByName — workspace ownership check', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies conversation ownership BEFORE ever reading its messages', async () => {
    agentConversationFindFirst.mockResolvedValue(null);

    const entries = await findToolResultsByName('conv-1', ['search_products'], 'ws-1');

    expect(entries).toEqual([]);
    expect(agentConversationFindFirst).toHaveBeenCalledWith({ where: { id: 'conv-1', workspaceId: 'ws-1' }, select: { id: true } });
    expect(agentMessageFindMany).not.toHaveBeenCalled();
  });

  it('reads messages only once ownership is confirmed', async () => {
    agentConversationFindFirst.mockResolvedValue({ id: 'conv-1' });
    agentMessageFindMany.mockResolvedValue([]);

    await findToolResultsByName('conv-1', ['search_products'], 'ws-1');

    expect(agentMessageFindMany).toHaveBeenCalledTimes(1);
  });

  it('a conversation owned by a DIFFERENT workspace returns [] — never throws, never leaks whether the conversation exists at all', async () => {
    agentConversationFindFirst.mockResolvedValue(null); // simulates {id: 'conv-1', workspaceId: 'ws-B'} matching nothing

    const entries = await findToolResultsByName('conv-1', ['search_products'], 'ws-B');

    expect(entries).toEqual([]);
  });

  it('correlates assistant tool_use blocks with their tool_result by tool_use_id, for a real, owned conversation', async () => {
    agentConversationFindFirst.mockResolvedValue({ id: 'conv-1' });
    agentMessageFindMany.mockResolvedValue([
      {
        role: 'assistant',
        content: JSON.stringify([{ type: 'tool_use', id: 'tu1', name: 'search_products', input: {} }]),
        createdAt: new Date(1),
      },
      {
        role: 'tool_result',
        content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'tu1', content: JSON.stringify({ results: [] }) }]),
        createdAt: new Date(2),
      },
    ]);

    const entries = await findToolResultsByName('conv-1', ['search_products'], 'ws-1');

    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe('search_products');
    expect(entries[0].result).toEqual({ results: [] });
  });

  it('ignores tool_use blocks for tools not in the requested list', async () => {
    agentConversationFindFirst.mockResolvedValue({ id: 'conv-1' });
    agentMessageFindMany.mockResolvedValue([
      { role: 'assistant', content: JSON.stringify([{ type: 'tool_use', id: 'tu1', name: 'calculate_margin', input: {} }]), createdAt: new Date(1) },
      { role: 'tool_result', content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'tu1', content: '{}' }]), createdAt: new Date(2) },
    ]);

    const entries = await findToolResultsByName('conv-1', ['search_products'], 'ws-1');

    expect(entries).toEqual([]);
  });

  it('never throws on malformed JSON content — silently excludes it', async () => {
    agentConversationFindFirst.mockResolvedValue({ id: 'conv-1' });
    agentMessageFindMany.mockResolvedValue([
      { role: 'assistant', content: 'not json', createdAt: new Date(1) },
      { role: 'tool_result', content: 'also not json', createdAt: new Date(2) },
    ]);

    await expect(findToolResultsByName('conv-1', ['search_products'], 'ws-1')).resolves.toEqual([]);
  });
});
