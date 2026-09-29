/**
 * AI-first listing workflow — extracts propose_listing_generation results
 * out of a message's raw toolCalls[], same pattern as listingDraftResults.ts
 * and sourcingResults.ts. Nothing here is trusted blindly — a malformed/
 * unexpected shape is excluded, never fabricated into something valid.
 */
export interface SelectionProposalOutcome {
  toolCallIndex: number;
  selected: boolean;
  sourceUrl?: string;
  title?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function extractSelectionProposalOutcomes(toolCalls: unknown[] | undefined): SelectionProposalOutcome[] {
  if (!Array.isArray(toolCalls)) return [];

  const outcomes: SelectionProposalOutcome[] = [];

  toolCalls.forEach((call, index) => {
    if (!isRecord(call) || call.name !== 'propose_listing_generation') return;

    const result = call.result;
    if (!isRecord(result)) return;

    if (result.selected === true && typeof result.sourceUrl === 'string' && typeof result.title === 'string') {
      outcomes.push({ toolCallIndex: index, selected: true, sourceUrl: result.sourceUrl, title: result.title });
      return;
    }

    outcomes.push({
      toolCallIndex: index,
      selected: false,
      error: typeof result.error === 'string' ? result.error : undefined,
    });
  });

  return outcomes;
}
