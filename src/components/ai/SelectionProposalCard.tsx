import { Sparkles, PencilLine } from 'lucide-react';
import { extractSelectionProposalOutcomes } from '@/lib/ai/selectionResults';

interface SelectionProposalCardProps {
  toolCalls: unknown[] | undefined;
  /** Omit to render without the action buttons (e.g. a read-only render). */
  onSend?: (message: string) => void;
}

/**
 * AI-first listing workflow — renders the two proactive-proposal actions
 * ("✨ Générer l'annonce" / "Créer manuellement") under an assistant turn
 * that called propose_listing_generation. Mirrors SourcingResultsGrid's
 * own onSend pattern exactly: a button sends a real chat message, it
 * never calls generate_listing_draft/create_product directly — the Agent
 * still runs its own full propose/confirm pipeline untouched.
 */
export function SelectionProposalCard({ toolCalls, onSend }: SelectionProposalCardProps) {
  const outcomes = extractSelectionProposalOutcomes(toolCalls);
  const selected = outcomes.filter((o) => o.selected);
  if (selected.length === 0) return null;

  return (
    <div className="mr-auto max-w-full sm:max-w-[85%] space-y-2">
      {selected.map((outcome) => (
        <div key={outcome.toolCallIndex} className="flex flex-wrap gap-2">
          {onSend && (
            <>
              <button
                type="button"
                onClick={() => onSend(`Oui, génère l'annonce automatiquement pour ce produit (${outcome.sourceUrl}).`)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#FF5A1F] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e64f18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
              >
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                Générer l&apos;annonce
              </button>
              <a
                href="/dashboard/products/new"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] px-3.5 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
              >
                <PencilLine className="w-4 h-4" aria-hidden="true" />
                Créer manuellement
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default SelectionProposalCard;
