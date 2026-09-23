'use client';

import { useState } from 'react';
import { applyDraftEdit, validateEbayDraft, validateEtsyDraft, type ListingDraft } from '@/lib/listing/listingDraft';
import { ListingDraftPreview } from './ListingDraftPreview';

const INPUT_CLASSES =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50';

interface ListingDraftEditorProps {
  draft: ListingDraft;
}

/**
 * Phase 12B — a client-only, instant-preview editor: every edit re-runs
 * the exact same pure applyDraftEdit/validateEbayDraft/validateEtsyDraft
 * this draft's own generation already used (src/lib/listing/listingDraft.ts),
 * so what's shown here is never a separate/duplicated validation path.
 *
 * Deliberately does NOT silently push an edit back into the conversation
 * (that would mean fabricating a fake user turn, or a new API call the
 * model never actually made) — it's a local "try before you tell the
 * Agent" preview. Actually recording an edit in the conversation still
 * only ever happens the same way every other Agent state change does:
 * the reseller describes it in the composer, and the model calls
 * edit_listing_draft for real (validated against this exact conversation's
 * own history — see that tool's own comment).
 */
export function ListingDraftEditor({ draft: initialDraft }: ListingDraftEditorProps) {
  const [draft, setDraft] = useState(initialDraft);

  const ebay = validateEbayDraft(draft);
  const etsy = validateEtsyDraft(draft);

  const handleChange = (patch: Partial<ListingDraft['fields']>) => {
    setDraft((current) => applyDraftEdit(current, patch));
  };

  return (
    <div className="mr-auto max-w-[85%] sm:max-w-[85%] space-y-3">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-3 text-sm">
        <p className="text-sm font-medium text-white">Modifier le brouillon (aperçu local)</p>

        <div>
          <label htmlFor="draft-title" className="mb-1 block text-xs text-gray-500">
            Titre
          </label>
          <input
            id="draft-title"
            value={draft.fields.title}
            onChange={(e) => handleChange({ title: e.target.value })}
            className={INPUT_CLASSES}
          />
        </div>

        <div>
          <label htmlFor="draft-price" className="mb-1 block text-xs text-gray-500">
            Prix proposé ({draft.fields.currency})
          </label>
          <input
            id="draft-price"
            type="number"
            min={0}
            value={draft.fields.price ?? ''}
            onChange={(e) => handleChange({ price: e.target.value === '' ? undefined : Number(e.target.value) })}
            className={INPUT_CLASSES}
          />
        </div>

        <div>
          <label htmlFor="draft-description" className="mb-1 block text-xs text-gray-500">
            Description
          </label>
          <textarea
            id="draft-description"
            value={draft.fields.description}
            onChange={(e) => handleChange({ description: e.target.value })}
            rows={4}
            className={`${INPUT_CLASSES} resize-none`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="draft-size" className="mb-1 block text-xs text-gray-500">
              Taille
            </label>
            <input
              id="draft-size"
              value={draft.fields.size ?? ''}
              onChange={(e) => handleChange({ size: e.target.value || undefined })}
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label htmlFor="draft-condition" className="mb-1 block text-xs text-gray-500">
              État
            </label>
            <input
              id="draft-condition"
              value={draft.fields.condition ?? ''}
              onChange={(e) => handleChange({ condition: e.target.value || undefined })}
              className={INPUT_CLASSES}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="draft-ebay-category" className="mb-1 block text-xs text-gray-500">
              Catégorie eBay (id)
            </label>
            <input
              id="draft-ebay-category"
              type="number"
              min={1}
              value={draft.fields.ebayCategoryId ?? ''}
              onChange={(e) => handleChange({ ebayCategoryId: e.target.value === '' ? undefined : Number(e.target.value) })}
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label htmlFor="draft-ebay-marketplace" className="mb-1 block text-xs text-gray-500">
              Marketplace eBay cible
            </label>
            <input
              id="draft-ebay-marketplace"
              placeholder="EBAY_FR"
              value={draft.fields.ebayMarketplaceId ?? ''}
              onChange={(e) => handleChange({ ebayMarketplaceId: e.target.value || undefined })}
              className={INPUT_CLASSES}
            />
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Aperçu local uniquement — pour enregistrer ce changement dans la conversation, décrivez-le à l&apos;Agent (ex. : « Mets le prix à{' '}
          {draft.fields.price ?? '…'} {draft.fields.currency} »).
        </p>
      </div>

      <ListingDraftPreview draft={draft} marketplaceValidation={{ ebay, etsy }} />
    </div>
  );
}

export default ListingDraftEditor;
