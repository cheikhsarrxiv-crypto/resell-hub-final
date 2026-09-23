import type { NormalizedSourcingResult } from '@/services/sourcing/types';
import type { ListingDraft, ListingDraftFieldKey } from '@/lib/listing/listingDraft';

/** eBay's own well-documented platform-wide title length limit — a defensive clamp, not a business fact this codebase asserts on its own authority. */
const EBAY_TITLE_MAX_LENGTH = 80;

function buildGeneratedTitle(result: NormalizedSourcingResult): string {
  // The source's own title is already real, human-authored text — never
  // replaced, only lightly prefixed with the brand when known and not
  // already present (case-insensitively) in it. Never invents color/
  // material/size/model/condition that aren't already in the source title.
  const hasBrandAlready = result.brand ? result.title.toLowerCase().includes(result.brand.toLowerCase()) : true;
  const title = result.brand && !hasBrandAlready ? `${result.brand} — ${result.title}` : result.title;
  return title.length > EBAY_TITLE_MAX_LENGTH ? title.slice(0, EBAY_TITLE_MAX_LENGTH) : title;
}

function describeAuthenticity(result: NormalizedSourcingResult): string {
  if (result.authenticityStatus === 'verified') {
    return `Authenticité vérifiée${result.authenticitySource ? ` (${result.authenticitySource})` : ''}.`;
  }
  if (result.authenticityStatus === 'claimed') {
    return "Authenticité déclarée par le vendeur source — non vérifiée indépendamment.";
  }
  return 'Authenticité non renseignée par la source.';
}

function buildGeneratedDescription(result: NormalizedSourcingResult): string {
  const lines: string[] = [];
  lines.push(result.brand ? `${result.brand} — ${result.title}` : result.title);
  lines.push('');
  lines.push(`État : ${result.condition ?? 'non précisé par la source'}`);
  lines.push(describeAuthenticity(result));
  if (result.shippingCost !== undefined) {
    lines.push(`Frais de port à la source : ${result.shippingCost} ${result.shippingCostCurrency ?? result.currency}`);
  }
  lines.push('');
  lines.push(`Annonce préparée à partir d'une source identifiée : ${result.sourceUrl}`);
  // Deliberately never mentions defects, certificate, invoice, provenance,
  // materials, purchase date, original store, or accessories — none of
  // that data exists anywhere in a NormalizedSourcingResult, so there is
  // nothing to fabricate: it's simply never written.
  return lines.join('\n');
}

/**
 * Phase 12B — the FACTUAL/GENERATED split this whole module exists to
 * enforce: every field in `source` is copied verbatim from the real,
 * already-fetched NormalizedSourcingResult; every field in `fields` that
 * ListingGenerationService itself sets is deterministic and traceable back
 * to one of those factual fields — never a second LLM call, never a guess.
 * `size`/`material`/`color` are never populated here because
 * NormalizedSourcingResult carries none of them; they stay absent until a
 * user edits them in.
 */
export class ListingGenerationService {
  static buildDraftFromSourcingResult(
    result: NormalizedSourcingResult,
    options: { proposedPrice?: number; proposedCurrency?: string } = {}
  ): ListingDraft {
    const source: ListingDraft['source'] = {
      sourceItemId: result.sourceUrl,
      sourceProductId: result.sourceId,
      sourceMarketplace: result.marketplace,
      sourceUrl: result.sourceUrl,
      title: result.title,
      brand: result.brand,
      condition: result.condition,
      images: result.images,
      price: result.price,
      currency: result.currency,
      shippingCost: result.shippingCost,
      shippingCostCurrency: result.shippingCostCurrency,
      authenticityStatus: result.authenticityStatus,
      authenticitySource: result.authenticitySource,
      sellerName: result.seller?.name,
    };

    const generatedFieldKeys: ListingDraftFieldKey[] = ['title', 'description', 'currency', 'quantity'];
    if (result.condition) generatedFieldKeys.push('condition');
    if (options.proposedPrice !== undefined) generatedFieldKeys.push('price');

    return {
      source,
      fields: {
        title: buildGeneratedTitle(result),
        description: buildGeneratedDescription(result),
        // A proposed SELLING price is only ever set here when the caller
        // explicitly supplied one (e.g. the reseller said "propose 449 €")
        // — never silently seeded from the source's own cost, which would
        // misrepresent a cost as a revenue proposal (see ListingDraftFields'
        // own comment).
        price: options.proposedPrice,
        currency: options.proposedCurrency ?? result.currency,
        // A sourced secondhand item is inherently a single unit — this is
        // an explicit, documented business default (§13's own carve-out),
        // never a stand-in for genuinely unknown data.
        quantity: 1,
        condition: result.condition,
      },
      generatedFieldKeys,
      editedFieldKeys: [],
      originalValues: {},
    };
  }
}

export default ListingGenerationService;
