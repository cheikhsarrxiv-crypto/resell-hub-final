import { extractListingDraftOutcomes } from '@/lib/ai/listingDraftResults';
import { ListingDraftEditor } from './ListingDraftEditor';

interface ListingDraftListProps {
  toolCalls: unknown[] | undefined;
}

/**
 * Mirrors MarginSummaryList/SourcingResultsGrid's own structure — one
 * ListingDraftEditor per real generate/edit_listing_draft outcome on this
 * message, an honest message (never a fabricated draft) for an error
 * outcome, and nothing at all when the turn had neither.
 */
export function ListingDraftList({ toolCalls }: ListingDraftListProps) {
  const outcomes = extractListingDraftOutcomes(toolCalls);
  if (outcomes.length === 0) return null;

  return (
    <div className="space-y-2">
      {outcomes.map((outcome) =>
        outcome.status === 'ok' && outcome.draft && outcome.marketplaceValidation ? (
          <ListingDraftEditor key={outcome.toolCallIndex} draft={outcome.draft} />
        ) : (
          <p key={outcome.toolCallIndex} className="mr-auto max-w-[85%] text-sm text-gray-500">
            {outcome.error ?? "Ce brouillon d'annonce n'a pas pu être préparé."}
          </p>
        )
      )}
    </div>
  );
}

export default ListingDraftList;
