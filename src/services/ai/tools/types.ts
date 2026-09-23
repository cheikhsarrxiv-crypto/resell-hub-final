import { z } from 'zod';

/**
 * Every tool the agent can call is assigned exactly one category, and the
 * category — not the tool's name or the model's intent — is what
 * AiAgentService uses to decide whether a call executes automatically.
 *
 * - 'read':    side-effect-free. Always auto-executed.
 * - 'write':   creates/updates ADKSY-internal, non-engaging state only
 *              (e.g. a draft). Always auto-executed — a draft is not
 *              visible anywhere else in the app and costs nothing.
 * - 'engage':  has a real external or financial effect (publishing a
 *              listing, sending an order to a fulfillment partner).
 *              NEVER auto-executed — see AiAgentService's dispatch loop.
 * - 'blocked': not available in this version at all (e.g. any future
 *              tool that would spend the reseller's money automatically).
 *              NEVER executed, regardless of what the model asks for.
 */
export type AgentToolCategory = 'read' | 'write' | 'engage' | 'blocked';

/**
 * JSON Schema subset accepted by Anthropic's `tools[].input_schema`. Kept
 * separate from the Zod schema (which does the real validation) because
 * this project has no zod-to-json-schema dependency — duplicating a
 * handful of small, stable schemas by hand is preferable to adding one
 * for this.
 */
export interface AgentToolJsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * Phase 12B — everything about the CURRENT turn a handler/preview may
 * legitimately need beyond workspaceId, still always server-verified,
 * never model- or client-supplied. Added as a third parameter (not a
 * breaking change: every existing 2-arg handler/preview — `(workspaceId,
 * input) => ...` — remains a valid AgentToolDefinition, since a function
 * with fewer declared parameters is always assignable where one with more
 * is expected, exactly like a standard `Array.prototype.map` callback).
 * Introduced so a tool can revalidate something against THIS conversation's
 * own prior tool results (see tools/listingDraftTools.ts's
 * "never trust a sourceUrl the model merely repeats back — confirm it was
 * really returned by search_products in this exact conversation" guard)
 * without ever trusting a conversationId the model could itself supply.
 */
export interface AgentToolContext {
  conversationId: string;
  userId: string;
}

export interface AgentToolDefinition<Input = any, Output = any> {
  /** Sent to Anthropic verbatim; must be unique across the registry. */
  name: string;
  /** Sent to Anthropic verbatim — describes when/why the model should call this. */
  description: string;
  category: AgentToolCategory;
  /** Validates the model's tool_use input before the handler ever sees it. */
  inputSchema: z.ZodType<Input>;
  jsonSchema: AgentToolJsonSchema;
  /**
   * workspaceId is always the caller-verified workspace (see
   * AiAgentService) — a tool handler must never accept or trust a
   * workspaceId sourced from `input`.
   */
  handler: (workspaceId: string, input: Input, context?: AgentToolContext) => Promise<Output>;
  /**
   * Phase 12A — required only for a tool whose category is 'engage'.
   * Produces the exact, backend-computed representation of what
   * confirming this action would do — built from real workspace data
   * (never from the model's own text), and it must not itself cause any
   * side effect (no writes, no external calls). AiActionService.proposeAction
   * calls this once, at proposal time, and stores its result verbatim as
   * the AgentAction row's `summary` — what the reseller actually sees
   * before confirming.
   *
   * A tool with no `preview` (every 'read'/'write' tool today, since they
   * auto-execute and never need a confirmation screen) simply never has
   * one built.
   */
  preview?: (workspaceId: string, input: Input, context?: AgentToolContext) => Promise<Record<string, unknown>>;
}

/** A tool that exists (is registered) but has no real handler yet. */
export const NOT_CONFIGURED = 'NOT_CONFIGURED' as const;
export const NOT_SUPPORTED = 'NOT_SUPPORTED' as const;
