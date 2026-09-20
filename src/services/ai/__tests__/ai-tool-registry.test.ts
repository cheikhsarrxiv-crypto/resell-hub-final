/**
 * Real behavioral tests for AiToolRegistry — the single choke point that
 * decides which tools exist and which categories may run automatically.
 * These are the guarantees AiAgentService's tool-use loop depends on, so
 * they're tested directly against the registry rather than only implied
 * by the service's own tests.
 */
import { describe, it, expect } from 'vitest';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getOrderTool } from '@/services/ai/tools/orderTools';
import { getListingTool } from '@/services/ai/tools/listingTools';

describe('AiToolRegistry.list / get', () => {
  it('lists get_order, get_listing, search_products, calculate_margin, simulate_engage_action, and publish_listing as currently registered tools', () => {
    const names = AiToolRegistry.list().map((t) => t.name);
    expect(names).toContain('get_order');
    expect(names).toContain('get_listing');
    expect(names).toContain('search_products');
    expect(names).toContain('calculate_margin');
    // Phase 12A: publish_listing exists as a real, confirmable 'engage'
    // framework action — its handler is a controlled simulation (never a
    // real marketplace call), see src/services/ai/tools/actionTools.ts.
    expect(names).toContain('simulate_engage_action');
    expect(names).toContain('publish_listing');
    // Etsy publication parity — same 'engage' shape as publish_listing,
    // its own separate real-call safeguard (see actionTools.ts).
    expect(names).toContain('publish_etsy_listing');
    // Phase 12B: draft preparation tools — always 'write' (never 'engage'),
    // since a draft has no external effect until publish_listing confirms.
    expect(names).toContain('generate_listing_draft');
    expect(names).toContain('edit_listing_draft');
  });

  it('does not list any tool that has no real handler yet (no fake tools)', () => {
    // Every registered tool must be a real AgentToolDefinition with a
    // callable handler — this is a structural guard against ever
    // registering a stub that "pretends" to work.
    for (const tool of AiToolRegistry.list()) {
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('get() returns undefined for an unregistered/unknown tool name', () => {
    expect(AiToolRegistry.get('compare_prices')).toBeUndefined();
    expect(AiToolRegistry.get('purchase_product')).toBeUndefined();
    expect(AiToolRegistry.get('send_order_to_fulfillment')).toBeUndefined();
    expect(AiToolRegistry.get('not_a_real_tool')).toBeUndefined();
  });

  it('publish_listing, publish_etsy_listing and simulate_engage_action are categorized "engage" — never auto-executable', () => {
    expect(AiToolRegistry.get('publish_listing')?.category).toBe('engage');
    expect(AiToolRegistry.get('publish_etsy_listing')?.category).toBe('engage');
    expect(AiToolRegistry.get('simulate_engage_action')?.category).toBe('engage');
  });

  it('generate_listing_draft and edit_listing_draft are categorized "write" — always auto-executable, no confirmation needed for a draft', () => {
    expect(AiToolRegistry.get('generate_listing_draft')?.category).toBe('write');
    expect(AiToolRegistry.get('edit_listing_draft')?.category).toBe('write');
    expect(AiToolRegistry.isAutoExecutable('write')).toBe(true);
  });

  it('get() returns the real get_order tool definition', () => {
    expect(AiToolRegistry.get('get_order')).toBe(getOrderTool);
  });

  it('get() returns the real get_listing tool definition', () => {
    expect(AiToolRegistry.get('get_listing')).toBe(getListingTool);
  });
});

describe('AiToolRegistry.toAnthropicTools', () => {
  it('produces one entry per registered tool with name/description/input_schema', () => {
    const tools = AiToolRegistry.toAnthropicTools();
    expect(tools.length).toBe(AiToolRegistry.list().length);
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeTruthy();
    }
  });
});

describe('AiToolRegistry.isAutoExecutable — the enforcement point for confirmation', () => {
  it('read and write tools are auto-executable', () => {
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
    expect(AiToolRegistry.isAutoExecutable('write')).toBe(true);
  });

  it('engage and blocked tools are never auto-executable', () => {
    expect(AiToolRegistry.isAutoExecutable('engage')).toBe(false);
    expect(AiToolRegistry.isAutoExecutable('blocked')).toBe(false);
  });
});

describe('get_order tool definition', () => {
  it('is categorized as read (side-effect-free)', () => {
    expect(getOrderTool.category).toBe('read');
  });

  it('rejects an input missing orderId', () => {
    const result = getOrderTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a valid orderId input', () => {
    const result = getOrderTool.inputSchema.safeParse({ orderId: 'order-123' });
    expect(result.success).toBe(true);
  });
});

describe('get_listing tool definition', () => {
  it('is categorized as read (side-effect-free)', () => {
    expect(getListingTool.category).toBe('read');
  });

  it('rejects an input missing listingId', () => {
    const result = getListingTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a valid listingId input', () => {
    const result = getListingTool.inputSchema.safeParse({ listingId: 'listing-123' });
    expect(result.success).toBe(true);
  });
});
