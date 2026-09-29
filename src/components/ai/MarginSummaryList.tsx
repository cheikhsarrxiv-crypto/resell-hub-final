import { extractMarginOutcomes } from '@/lib/ai/marginResults';
import { MarginSummary } from './MarginSummary';

interface MarginSummaryListProps {
  toolCalls: unknown[] | undefined;
}

/**
 * Renders whatever calculate_margin actually returned for one assistant
 * turn — nothing if the turn never called it (§10.A), a real summary if
 * it produced one (§10.B/C, handled inside MarginSummary itself for the
 * "partial" cases), and a generic, honest message (never the backend's
 * raw error text) if the tool call itself failed (§10.D).
 */
export function MarginSummaryList({ toolCalls }: MarginSummaryListProps) {
  const outcomes = extractMarginOutcomes(toolCalls);
  if (outcomes.length === 0) return null;

  return (
    <div className="mr-auto max-w-full sm:max-w-[85%] space-y-3">
      {outcomes.map((outcome) =>
        outcome.status === 'ok' ? (
          <MarginSummary key={outcome.toolCallIndex} result={outcome.result} />
        ) : (
          <p key={outcome.toolCallIndex} className="text-sm text-gray-500 italic">
            Le calcul de marge n&apos;a pas pu être effectué.
          </p>
        )
      )}
    </div>
  );
}

export default MarginSummaryList;
