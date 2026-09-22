import { extractSourcingOutcomes, formatProviderName } from '@/lib/ai/sourcingResults';
import { SourcingResultCard } from './SourcingResultCard';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

interface SourcingResultsGridProps {
  toolCalls: unknown[] | undefined;
  /**
   * Phase 4 — optional. When provided, every card's "Créer un produit"
   * sends a real chat message through this (see
   * SourcingResultCard.onCreateProduct's own comment — it never calls
   * create_product directly). Omit for a read-only render (no button).
   */
  onSend?: (message: string) => void;
}

function buildCreateProductPrompt(result: NormalizedSourcingResult): string {
  return `Crée un produit à partir de cette annonce : "${result.title}" (${result.sourceUrl}).`;
}

function formatProviderList(names: string[]): string {
  return names.map(formatProviderName).join(', ');
}

/**
 * Renders whatever search_products actually returned for one assistant
 * turn — nothing if the turn never called it, real cards if it found
 * something, and an honest explanation (never a silent gap, never a
 * fabricated "no results") when it ran but came back empty/unavailable.
 *
 * Phase 4 — also surfaces PARTIAL results honestly: when at least one
 * provider failed or was unavailable but another still returned real
 * results, this says so explicitly (never silently shows only the
 * successful provider's results as if that were the whole picture).
 */
export function SourcingResultsGrid({ toolCalls, onSend }: SourcingResultsGridProps) {
  const outcomes = extractSourcingOutcomes(toolCalls);
  if (outcomes.length === 0) return null;

  return (
    <div className="mr-auto max-w-full sm:max-w-[85%] space-y-3">
      {outcomes.map((outcome) => {
        if (outcome.status === 'SOURCE_NOT_CONFIGURED') {
          return (
            <p key={outcome.toolCallIndex} className="text-sm text-gray-500 italic">
              Recherche de produits indisponible pour le moment (aucune source configurée).
            </p>
          );
        }

        // Real, structured provenance only — never inferred. A provider
        // that never even ran (providersUnavailable) is distinguished
        // from one that ran and errored (providersFailed) in the wording
        // below, but both count as "not represented in these results".
        const problemProviders = [...outcome.providersFailed, ...outcome.providersUnavailable];
        const isPartial = outcome.results.length > 0 && problemProviders.length > 0;

        if (outcome.results.length === 0) {
          return (
            <div key={outcome.toolCallIndex} className="space-y-1">
              <p className="text-sm text-gray-500 italic">
                {outcome.providerErrors.length > 0
                  ? 'Recherche temporairement indisponible auprès du fournisseur.'
                  : 'Aucun résultat trouvé pour cette recherche.'}
              </p>
              {problemProviders.length > 0 && (
                <p className="text-xs text-amber-400/90">
                  ⚠ Indisponible pour le moment : {formatProviderList(problemProviders)}.
                </p>
              )}
            </div>
          );
        }

        return (
          <div key={outcome.toolCallIndex} className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
              <span>
                {outcome.totalResults} résultat{outcome.totalResults === 1 ? '' : 's'}
                {outcome.providersSearched.length > 0 ? ` · ${formatProviderList(outcome.providersSearched)}` : ''}
              </span>
              {outcome.requestedWorldwide && (
                <span className="text-gray-500">
                  <span aria-hidden="true">·</span> recherche mondiale (sources ADKSY actuellement disponibles, pas l&apos;ensemble d&apos;Internet)
                </span>
              )}
            </div>

            {isPartial && (
              <p className="text-xs text-amber-400/90">
                ⚠ Résultats partiels — {formatProviderList(problemProviders)} indisponible pour cette recherche. Affichage des résultats de{' '}
                {formatProviderList(outcome.providersSearched.filter((p) => !problemProviders.includes(p)))}.
              </p>
            )}

            {outcome.providersSkipped.length > 0 && (
              <p className="text-xs text-gray-500">Fournisseur(s) volontairement exclu(s) de cette recherche : {formatProviderList(outcome.providersSkipped)}.</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {outcome.results.map((result, i) => (
                // sourceId isn't always present on every provider result —
                // falling back to the array position is fine here since
                // this list is only ever re-derived from a fixed response,
                // never reordered/filtered client-side.
                <SourcingResultCard
                  key={result.sourceId ?? `${outcome.toolCallIndex}-${i}`}
                  result={result}
                  onCreateProduct={onSend ? (r) => onSend(buildCreateProductPrompt(r)) : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SourcingResultsGrid;
