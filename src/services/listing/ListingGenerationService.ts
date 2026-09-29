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
/**
 * Pure algebra, never a guess: given a real purchase price and a real,
 * explicitly-supplied target margin percentage, returns the selling price
 * that yields exactly that margin (margin defined as (price - cost) /
 * price, the same definition PricingService.calculateMargin itself uses).
 * Returns null for a degenerate input (>=100% margin, which has no finite
 * price) rather than an invented/Infinity value.
 */
function computePriceForTargetMargin(purchasePrice: number, targetMarginPercent: number): number | null {
  if (targetMarginPercent >= 100 || targetMarginPercent < 0) return null;
  const price = purchasePrice / (1 - targetMarginPercent / 100);
  return Math.round(price * 100) / 100;
}

export class ListingGenerationService {
  static buildDraftFromSourcingResult(
    result: NormalizedSourcingResult,
    options: {
      proposedPrice?: number;
      proposedCurrency?: string;
      /**
       * Deliberately NOT a default/fallback business rule — only ever
       * applied when the caller (the Agent, echoing a target margin the
       * reseller explicitly stated) supplies one AND proposedPrice was
       * NOT already given directly. No default target margin exists or
       * is invented anywhere in this codebase (see the AI-first listing
       * workflow audit) — omit both and `price` stays undefined, exactly
       * as before this option existed.
       */
      targetMarginPercent?: number;
    } = {}
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

    // Computed ONLY when the caller gave a target margin AND no direct
    // proposedPrice — pure algebra on the source's own real price, in the
    // source's own currency (converting to proposedCurrency here would
    // need a real FX rate this function has no access to and never
    // guesses at — see computePriceForTargetMargin's own comment).
    const marginBasedPrice =
      options.proposedPrice === undefined && options.targetMarginPercent !== undefined
        ? computePriceForTargetMargin(result.price, options.targetMarginPercent) ?? undefined
        : undefined;
    const proposedPrice = options.proposedPrice ?? marginBasedPrice;

    const generatedFieldKeys: ListingDraftFieldKey[] = ['title', 'description', 'currency', 'quantity'];
    if (result.condition) generatedFieldKeys.push('condition');
    if (proposedPrice !== undefined) generatedFieldKeys.push('price');

    return {
      source,
      fields: {
        title: buildGeneratedTitle(result),
        description: buildGeneratedDescription(result),
        // A proposed SELLING price is only ever set here when the caller
        // explicitly supplied one, OR derived by pure algebra from an
        // explicitly-supplied target margin (e.g. the reseller said
        // "propose 449 €" or "avec une marge de 30%") — never silently
        // seeded from the source's own cost, which would misrepresent a
        // cost as a revenue proposal (see ListingDraftFields' own comment).
        price: proposedPrice,
        currency: marginBasedPrice !== undefined ? result.currency : (options.proposedCurrency ?? result.currency),
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
