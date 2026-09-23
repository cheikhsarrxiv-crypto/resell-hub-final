/**
 * Phase 12B — renders a ListingDraft exactly as the backend produced it
 * (ListingGenerationService + validateEbayDraft/validateEtsyDraft) —
 * never re-derived or recalculated here. Same pattern as MarginSummary/
 * SourcingResultCard: plain React text children only, never
 * dangerouslySetInnerHTML, so a source-provided title/description can
 * never inject markup.
 */
import type { ListingDraft, MarketplaceListingValidation } from '@/lib/listing/listingDraft';

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

interface ListingDraftPreviewProps {
  draft: ListingDraft;
  marketplaceValidation: { ebay: MarketplaceListingValidation; etsy: MarketplaceListingValidation };
}

export function ListingDraftPreview({ draft, marketplaceValidation }: ListingDraftPreviewProps) {
  const { source, fields } = draft;
  const priceIsProposal = fields.price !== undefined;

  return (
    <div className="mr-auto max-w-[85%] sm:max-w-[85%] rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white">Brouillon d&apos;annonce</span>
        <span className="text-xs text-gray-500">Aucune publication réelle</span>
      </div>

      {source.images[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source.images[0]}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-32 w-full rounded-xl object-cover"
        />
      )}

      <div>
        <p className="text-xs text-gray-500">Titre {draft.editedFieldKeys.includes('title') ? '(modifié)' : draft.generatedFieldKeys.includes('title') ? '(généré)' : ''}</p>
        <p className="text-gray-200">{fields.title}</p>
      </div>

      <div>
        <p className="text-xs text-gray-500">
          Prix proposé {draft.editedFieldKeys.includes('price') ? '(modifié)' : ''}
        </p>
        <p className="text-gray-200">
          {priceIsProposal ? `${fields.price} ${fields.currency} (proposition)` : 'Non proposé — à définir'}
        </p>
        <p className="text-xs text-gray-500">
          Prix constaté à la source : {source.price} {source.currency}
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-500">Description {draft.editedFieldKeys.includes('description') ? '(modifiée)' : '(générée)'}</p>
        <p className="whitespace-pre-wrap text-gray-300">{fields.description}</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        {source.brand && <span>Marque : {source.brand}</span>}
        {fields.condition && <span>État : {fields.condition}</span>}
        {fields.size && <span>Taille : {fields.size}</span>}
        {!fields.size && <span>Taille : non renseignée</span>}
      </div>

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
