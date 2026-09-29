/**
 * Phase 12B — renders a ListingDraft exactly as the backend produced it
 * (ListingGenerationService + validateEbayDraft/validateEtsyDraft) —
 * never re-derived or recalculated here. Same pattern as MarginSummary/
 * SourcingResultCard: plain React text children only, never
 * dangerouslySetInnerHTML, so a source-provided title/description can
 * never inject markup.
 */
import type { ListingDraft, MarketplaceListingValidation } from '@/lib/listing/listingDraft';
import type { MarginCalculationResult } from '@/services/pricing/types';

const AUTHENTICITY_LABEL: Record<ListingDraft['source']['authenticityStatus'], string> = {
  verified: 'Vérifiée',
  claimed: 'Déclarée par le vendeur (non vérifiée)',
  unverified: 'Non renseignée',
  // No current provider emits this — see AuthenticityStatus's own comment.
  unknown: 'Non déterminable pour cette source',
};

const AUTHENTICITY_CLASSES: Record<ListingDraft['source']['authenticityStatus'], string> = {
  verified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  claimed: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  unverified: 'bg-white/[0.06] text-gray-400 border-white/[0.1]',
  unknown: 'bg-white/[0.06] text-gray-400 border-white/[0.1]',
};

function MarketplaceReadiness({ validation, label }: { validation: MarketplaceListingValidation; label: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            validation.ready ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.06] text-gray-400 border-white/[0.1]'
          }`}
        >
          {validation.ready ? 'Prêt' : 'Non prêt'}
        </span>
      </div>
      {validation.errors.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {validation.errors.map((e) => (
            <li key={e} className="text-xs text-red-300">
              {e}
            </li>
          ))}
        </ul>
      )}
      {validation.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {validation.warnings.map((w) => (
            <li key={w} className="text-xs text-gray-500">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * AI-first listing workflow — renders exactly what PricingService itself
 * returned (see listingDraftTools.ts's computeMarginPreview, which reuses
 * calculate_margin's own engine), never a separately recomputed number.
 * marginPercent/netProfit can be individually null while marginPreview
 * itself is non-null (some cost line couldn't be resolved) — that state
 * is shown honestly via missingData/warnings, never hidden or replaced
 * with a guess.
 */
function MarginPreview({ margin }: { margin: MarginCalculationResult }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">Marge estimée</span>
        <span className="text-xs text-gray-200">
          {margin.marginPercent !== null && margin.marginAmount !== null
            ? `${margin.marginAmount.toFixed(2)} ${margin.currency} (${margin.marginPercent.toFixed(1)}%)`
            : 'Incomplète — voir ci-dessous'}
        </span>
      </div>
      {margin.isEstimate && <p className="text-[11px] text-amber-300">Estimation — au moins une donnée n&apos;est pas un taux/coût garanti en temps réel.</p>}
      {margin.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {margin.warnings.map((w) => (
            <li key={w} className="text-[11px] text-gray-500">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ListingDraftPreviewProps {
  draft: ListingDraft;
  marketplaceValidation: { ebay: MarketplaceListingValidation; etsy: MarketplaceListingValidation };
  /** AI-first listing workflow — omit when unavailable (e.g. no proposed price yet); never fabricated client-side. */
  marginPreview?: MarginCalculationResult | null;
  /** AI-first listing workflow — per-image exclude/restore action; omitted renders the gallery read-only (see ListingDraftEditor, the only caller that passes it). */
  onToggleImageExclusion?: (imageUrl: string, excluded: boolean) => void;
}

export function ListingDraftPreview({ draft, marketplaceValidation, marginPreview, onToggleImageExclusion }: ListingDraftPreviewProps) {
  const { source, fields } = draft;
  const priceIsProposal = fields.price !== undefined;
  const excludedImageUrls = new Set(draft.excludedImageUrls ?? []);

  return (
    <div className="mr-auto max-w-[85%] sm:max-w-[85%] rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white">Brouillon d&apos;annonce</span>
        <span className="text-xs text-gray-500">Aucune publication réelle</span>
      </div>

      {source.images.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-500">Photos ({source.images.length}) — reprises de l&apos;annonce source, jamais vérifiées ni hébergées par ADKSY</p>
          <div className="flex gap-2 overflow-x-auto">
            {source.images.map((imageUrl, i) => {
              const excluded = excludedImageUrls.has(imageUrl);
              return (
                <div key={imageUrl + i} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className={`h-24 w-24 rounded-xl object-cover ${excluded ? 'opacity-40' : ''}`}
                  />
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white">
                    {excluded ? 'Réelle — non utilisée' : 'Réelle'}
                  </span>
                  {onToggleImageExclusion && (
                    <button
                      type="button"
                      onClick={() => onToggleImageExclusion(imageUrl, !excluded)}
                      className="absolute top-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-black/90"
                    >
                      {excluded ? 'Remettre' : 'Retirer'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(draft.generatedImages?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 text-xs text-gray-500">
            Photos générées par IA ({draft.generatedImages!.length}) — ne représentent pas nécessairement l&apos;objet réel
          </p>
          <div className="flex gap-2 overflow-x-auto">
            {draft.generatedImages!.map((image, i) => {
              const excluded = excludedImageUrls.has(image.url);
              return (
                <div key={image.url + i} className="relative shrink-0" title={image.prompt}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className={`h-24 w-24 rounded-xl object-cover ${excluded ? 'opacity-40' : ''}`}
                  />
                  <span className="absolute bottom-1 left-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-medium text-black">
                    {excluded ? 'Générée — non utilisée' : 'Générée'}
                  </span>
                  {onToggleImageExclusion && (
                    <button
                      type="button"
                      onClick={() => onToggleImageExclusion(image.url, !excluded)}
                      className="absolute top-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-black/90"
                    >
                      {excluded ? 'Remettre' : 'Retirer'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-gray-500">Titre {draft.editedFieldKeys.includes('title') ? '(modifié)' : draft.generatedFieldKeys.includes('title') ? '(généré)' : ''}</p>
        <p className="text-gray-200">{fields.title}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">Prix d&apos;achat (constaté à la source)</p>
          <p className="text-gray-200">{source.price} {source.currency}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">
            Prix de vente proposé {draft.editedFieldKeys.includes('price') ? '(modifié)' : ''}
          </p>
          <p className="text-gray-200">
            {priceIsProposal ? `${fields.price} ${fields.currency} (proposition)` : 'Non proposé — à définir'}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-500">Description {draft.editedFieldKeys.includes('description') ? '(modifiée)' : '(générée)'}</p>
        <p className="whitespace-pre-wrap text-gray-300">{fields.description}</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        {source.brand && <span>Marque : {source.brand}</span>}
        {fields.condition && <span>État : {fields.condition}</span>}
        <span>Taille : {fields.size ?? 'non renseignée'}</span>
        <span>Couleur : {fields.color ?? 'non renseignée'}</span>
        <span>Matière : {fields.material ?? 'non renseignée'}</span>
        <span>Modèle : {fields.model ?? 'non renseigné'}</span>
        <span>SKU : {fields.sku ?? 'non défini'}</span>
      </div>

      {marginPreview && <MarginPreview margin={marginPreview} />}

      <span
        className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${AUTHENTICITY_CLASSES[source.authenticityStatus]}`}
      >
        Authenticité : {AUTHENTICITY_LABEL[source.authenticityStatus]}
      </span>

      {/* Phase 12C-Prep: shown exactly as they'd be sent — these two
          fields are never inferred/guessed (see validateEbayDraft), so an
          absent value here means the eBay draft genuinely is not ready,
          never a placeholder. */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        <span>Catégorie eBay : {fields.ebayCategoryId ?? 'non définie'}</span>
        <span>Marketplace eBay cible : {fields.ebayMarketplaceId ?? 'non définie'}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <MarketplaceReadiness validation={marketplaceValidation.ebay} label="eBay" />
        <MarketplaceReadiness validation={marketplaceValidation.etsy} label="Etsy" />
      </div>
    </div>
  );
}

export default ListingDraftPreview;
