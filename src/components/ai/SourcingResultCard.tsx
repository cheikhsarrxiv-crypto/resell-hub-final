import { ExternalLink, PackagePlus } from 'lucide-react';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';
import { formatMarketplaceLabel, formatSourcingPrice, formatUnknownCostFactor } from '@/lib/ai/sourcingResults';

interface SourcingResultCardProps {
  result: NormalizedSourcingResult;
  /**
   * Phase 4 — optional. When provided, "Créer un produit" sends a real
   * chat message asking the Agent to create a product from this exact
   * result (by title + sourceUrl) — it never calls create_product
   * directly from here. The Agent still runs its own existing
   * propose/confirm pipeline (source/sourceId/sourceUrl revalidation,
   * explicit reseller confirmation) exactly as if the reseller had typed
   * the request themselves; nothing about that flow is bypassed or
   * shortened. Omitted entirely, no button is rendered (e.g. when the
   * caller has no way to send a message, like a read-only render).
   */
  onCreateProduct?: (result: NormalizedSourcingResult) => void;
}

/**
 * Authenticity is displayed with its exact meaning preserved — never
 * reworded to a bare "Authentic". 'verified' means a real, institutional
 * program (currently only eBay's Authenticity Guarantee) covers the item
 * — see `result.authenticitySource`, shown separately below, for exactly
 * which one; 'claimed' means only the seller's own listing says so —
 * even a seller who writes "100% authentic" in the title never earns
 * more than this label, because that text is still just their own claim,
 * not an institutional check; 'unverified' means no usable content to
 * even form a claim from; 'unknown' means this source has no
 * authenticity signal mechanism at all. The AiAgentService system prompt
 * enforces the same distinction in the Agent's own text; this is the
 * same rule enforced on the card side.
 */
const AUTHENTICITY_LABEL: Record<NormalizedSourcingResult['authenticityStatus'], string> = {
  verified: 'Authenticité vérifiée',
  claimed: 'Authenticité déclarée par le vendeur',
  unverified: 'Authenticité non renseignée',
  unknown: 'Aucune information d’authenticité',
};

const AUTHENTICITY_CLASSES: Record<NormalizedSourcingResult['authenticityStatus'], string> = {
  verified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  claimed: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  unverified: 'bg-white/[0.06] text-gray-400 border-white/10',
  unknown: 'bg-white/[0.06] text-gray-400 border-white/10',
};

export function SourcingResultCard({ result, onCreateProduct }: SourcingResultCardProps) {
  const image = result.images[0];
  const showNormalizedPrice = result.normalizedPriceEur !== undefined && result.currency.toUpperCase() !== 'EUR';
  const hasKnownCost = result.estimatedKnownCostEur !== undefined;
  const hasUnknownCosts = (result.unknownCostFactors?.length ?? 0) > 0;
  const hasMargin = result.estimatedMargin !== undefined && result.estimatedMarginPercent !== undefined;
  const hasMatchReasons = (result.matchReasons?.length ?? 0) > 0;
  const hasWarnings = (result.warnings?.length ?? 0) > 0;

  return (
    <div className="flex flex-col bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
      <div className="aspect-square w-full bg-white/[0.04] flex items-center justify-center overflow-hidden">
        {image ? (
          // Seller-provided image from an external, untrusted source
          // (eBay/Etsy) — a plain <img>, never rendered as HTML/markup,
          // and never assumed to exist (no image -> the placeholder
          // below, never a fabricated URL).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={result.title} className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-xs text-gray-600">Aucune image</span>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3.5">
        <div>
          <p className="text-sm font-medium text-white leading-snug line-clamp-2" title={result.title}>
            {result.title}
          </p>
          {result.brand && <p className="text-xs text-gray-500 mt-0.5">{result.brand}</p>}
        </div>

        <div className="flex items-baseline gap-1.5 flex-wrap">
          <p className="text-base font-semibold text-white">{formatSourcingPrice(result.price, result.currency)}</p>
          {showNormalizedPrice && (
            <span className="text-xs text-gray-500">≈ {formatSourcingPrice(result.normalizedPriceEur as number, 'EUR')}</span>
          )}
        </div>

        <p className="text-xs text-gray-400">
          {result.shippingCost === undefined
            ? 'Livraison : inconnue'
            : result.shippingCost === 0
              ? 'Livraison gratuite'
              : `Livraison ${formatSourcingPrice(result.shippingCost, result.shippingCostCurrency ?? result.currency)}`}
        </p>

        {(hasKnownCost || hasUnknownCosts) && (
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2 text-xs space-y-1">
            {hasKnownCost ? (
              <p className="text-gray-300">
                Coût connu estimé : <span className="font-medium text-white">{formatSourcingPrice(result.estimatedKnownCostEur as number, 'EUR')}</span>
              </p>
            ) : (
              <p className="text-gray-500">Coût connu estimé : non calculable pour l&apos;instant</p>
            )}
            {hasUnknownCosts && (
              <div>
                <p className="text-gray-500">Non inclus dans ce montant :</p>
                <ul className="mt-0.5 space-y-0.5">
                  {result.unknownCostFactors!.map((factor) => (
                    <li key={factor} className="text-amber-400/90">
                      — {formatUnknownCostFactor(factor)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {hasMargin && (
          <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 px-2.5 py-2 text-xs space-y-0.5">
            {result.targetResalePrice !== undefined && (
              <p className="text-gray-400">
                Revente cible : <span className="text-gray-200">{formatSourcingPrice(result.targetResalePrice, 'EUR')}</span>
              </p>
            )}
            <p className="text-gray-400">
              Marge estimée : <span className="font-medium text-emerald-400">{formatSourcingPrice(result.estimatedMargin as number, 'EUR')}</span>
            </p>
            <p className="text-gray-400">
              Marge estimée : <span className="font-medium text-emerald-400">{(result.estimatedMarginPercent as number).toFixed(1)} %</span>
            </p>
            <p className="text-gray-500">Aperçu — hors frais de vente marketplace et taxes d&apos;import</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <span>{formatMarketplaceLabel(result.marketplace, result.source)}</span>
          {result.itemLocationCountry && (
            <>
              <span aria-hidden="true">·</span>
              <span>{result.itemLocationCountry}</span>
            </>
          )}
          {result.condition && (
            <>
              <span aria-hidden="true">·</span>
              <span>{result.condition}</span>
            </>
          )}
          {result.seller?.name && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {result.seller.name}
                {result.seller.feedbackPercentage !== undefined ? ` (${result.seller.feedbackPercentage}% avis positifs)` : ''}
              </span>
            </>
          )}
        </div>

        <div>
          <span
            className={`inline-flex w-fit items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${AUTHENTICITY_CLASSES[result.authenticityStatus]}`}
          >
            {AUTHENTICITY_LABEL[result.authenticityStatus]}
          </span>
          {result.authenticitySource && <p className="mt-1 text-[11px] text-gray-500">{result.authenticitySource}</p>}
        </div>

        {hasMatchReasons && (
          <ul className="space-y-0.5">
            {result.matchReasons!.map((reason, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-emerald-400">
                <span aria-hidden="true">✓</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}

        {hasWarnings && (
          <ul className="space-y-0.5">
            {result.warnings!.map((warning, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-amber-400/90">
                <span aria-hidden="true">⚠</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-1">
          <a
            href={result.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Voir l’annonce : ${result.title}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#FF5A1F] hover:text-[#ff7a45] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded"
          >
            Voir l&apos;annonce
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>

          {onCreateProduct && (
            <button
              type="button"
              onClick={() => onCreateProduct(result)}
              aria-label={`Créer un produit à partir de : ${result.title}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded"
            >
              <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
              Créer un produit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SourcingResultCard;
