/**
 * classifyAgentError (POST /api/ai/agent 500 diagnostic fix) — pure
 * function, zero mocking needed, same convention as
 * agentConversation.ts's own mapAgentErrorToMessage tests. Covers the
 * coarse category attached to sendMessage's catch-all error log
 * (errorCategory), never asserted against the real logger here since
 * ai-agent-service.test.ts and its sibling files don't mock @/lib/logger
 * — this keeps that existing setup untouched.
 */
import { describe, it, expect } from 'vitest';
import { classifyAgentError } from '@/services/ai/AiAgentService';

describe('classifyAgentError', () => {
  it('any Anthropic API error -> "anthropic_api", regardless of which step it happened on', () => {
    expect(classifyAgentError('anthropic_messages_create', true)).toBe('anthropic_api');
    expect(classifyAgentError('persisting_assistant_message', true)).toBe('anthropic_api');
  });

  it('a non-Anthropic error during any "persisting_*" step -> "database" (Prisma write)', () => {
    expect(classifyAgentError('persisting_assistant_message', false)).toBe('database');
    expect(classifyAgentError('persisting_tool_result', false)).toBe('database');
    expect(classifyAgentError('persisting_final_reply', false)).toBe('database');
    expect(classifyAgentError('persisting_timeout_summary', false)).toBe('database');
  });

  it('a non-Anthropic error during "processing_tool_calls" -> "database" (the only non-locally-caught sub-operation there is AiUsageService.reserveUsage)', () => {
    expect(classifyAgentError('processing_tool_calls', false)).toBe('database');
  });

  it('a non-Anthropic error on any other/unrecognized step -> "unknown", never guessed at', () => {
    expect(classifyAgentError('anthropic_messages_create', false)).toBe('unknown');
    expect(classifyAgentError('some_future_step', false)).toBe('unknown');
  });
});
