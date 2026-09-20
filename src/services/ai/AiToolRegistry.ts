import { AgentToolDefinition, AgentToolCategory } from './tools/types';
import { getOrderTool } from './tools/orderTools';
import { searchProductsTool } from './tools/sourcingTools';
import { calculateMarginTool } from './tools/pricingTools';
import { simulateEngageActionTool, publishListingTool, publishEtsyListingTool } from './tools/actionTools';
import { generateListingDraftTool, editListingDraftTool } from './tools/listingDraftTools';

/**
 * Every tool the agent can currently call. Adding a tool means adding one
 * entry here — nothing elsewhere needs to change. Deliberately small
 * today: only tools with a real backend handler are registered. A tool
 * conceptually planned for later (send_customer_message,
 * purchase_product, send_order_to_fulfillment, ...) is simply not listed
 * here yet, rather than registered with a fake handler that pretends to
 * work — see AiAgentService's system prompt, which tells the model
 * exactly this.
 *
 * Phase 12A: simulate_engage_action and publish_listing are 'engage'
 * category — see AiAgentService's tool-use loop and AiActionService for
 * why calling either of them never runs their handler immediately, and
 * tools/actionTools.ts for why publish_listing's handler is a controlled
 * simulation, never a real marketplace call.
 */
const TOOLS: AgentToolDefinition[] = [
  getOrderTool,
  searchProductsTool,
  calculateMarginTool,
  simulateEngageActionTool,
  publishListingTool,
  publishEtsyListingTool,
  generateListingDraftTool,
  editListingDraftTool,
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export class AiToolRegistry {
  static list(): AgentToolDefinition[] {
    return TOOLS;
  }

  static get(name: string): AgentToolDefinition | undefined {
    return TOOLS_BY_NAME.get(name);
  }

  /** The exact shape Anthropic's `tools` request parameter expects. */
  static toAnthropicTools(): Array<{ name: string; description: string; input_schema: unknown }> {
    return TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.jsonSchema,
    }));
  }

  /**
   * Whether a tool's category permits AiAgentService to run its handler
   * the moment the model asks for it, with no human confirmation step.
   * This is the single choke point that makes "the model can never
   * publish/spend on its own" an enforced property of the code rather
   * than a prompt instruction the model could ignore or be tricked past.
   */
  static isAutoExecutable(category: AgentToolCategory): boolean {
    return category === 'read' || category === 'write';
  }
}

export default AiToolRegistry;
