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

/**
 * Free listing creation (real photo analysis) — the reseller's own
 * explicitly-stated facts about an item they already own, not previously
 * sourced anywhere. Every field is optional because the "never invent"
 * rule applies at the call site (listingDraftTools.ts), not here: this
 * function never defaults/guesses a field that is genuinely absent.
 */
export interface FreeListingDraftInput {
  title: string;
  brand?: string;
  condition?: string;
  size?: string;
  color?: string;
  material?: string;
  model?: string;
  proposedPrice?: number;
  proposedCurrency?: string;
}

export interface FreeDraftPhoto {
  url: string;
  storagePath: string;
  mimeType: string;
}

function buildFreeTitle(input: FreeListingDraftInput): string {
  // The reseller's own title, verbatim — never rewritten/embellished, only
  // clamped to eBay's real platform-wide limit (the same defensive clamp
  // buildGeneratedTitle already applies to a sourced draft's title).
  return input.title.length > EBAY_TITLE_MAX_LENGTH ? input.title.slice(0, EBAY_TITLE_MAX_LENGTH) : input.title;
}

function buildFreeDescription(input: FreeListingDraftInput, photoCount: number): string {
  const lines: string[] = [];
  lines.push(input.title);
  if (input.brand) lines.push(`Marque : ${input.brand}`);
  if (input.condition) lines.push(`État : ${input.condition}`);
  if (input.size) lines.push(`Taille : ${input.size}`);
  if (input.color) lines.push(`Couleur : ${input.color}`);
  if (input.material) lines.push(`Matière : ${input.material}`);
  if (input.model) lines.push(`Modèle : ${input.model}`);
  lines.push('');
  lines.push(
    photoCount > 0
      ? `Annonce créée directement par le vendeur à partir de ${photoCount} photo(s) réelle(s) fournie(s) en conversation — aucune donnée externe sourcée.`
      : "Annonce créée directement par le vendeur à partir des informations fournies en conversation — aucune donnée externe sourcée, aucune photo fournie pour l'instant."
  );
  // Deliberately never adds a fact not already in `input` — exactly the
  // same "never fabricate" discipline buildGeneratedDescription already
  // applies to a sourced draft.
  return lines.join('\n');
}

export class ListingGenerationService {
  /**
   * Free listing creation (real photo analysis) — builds a ListingDraft
   * with NO external source at all, from the reseller's own explicitly-
   * stated facts and any real photo(s) they already uploaded to this
   * conversation (see generate_listing_draft's free-mode handler, which
   * collects those via findToolResultsByName('user_photos_uploaded') —
   * never a second upload mechanism). `draftId` is the caller-minted
   * stable identifier (see generateListingDraftTool's handler) used as
   * this draft's own sourceItemId, exactly like a sourced draft's
   * sourceItemId is its sourceUrl — both are simply "the key
   * findLatestDraft looks up this exact draft by".
   */
  static buildFreeDraft(input: FreeListingDraftInput, photos: FreeDraftPhoto[], draftId: string): ListingDraft {
    const source: ListingDraft['source'] = {
      kind: 'free',
      sourceItemId: draftId,
      title: input.title,
      brand: input.brand,
      condition: input.condition,
      // Real, ADKSY-hosted photo URLs the reseller themselves uploaded —
      // never an external hotlink (contrast with a sourced draft's
      // source.images, which are the external listing's own URLs).
      images: photos.map((p) => p.url),
      size: input.size,
      color: input.color,
      material: input.material,
    };

    const generatedFieldKeys: ListingDraftFieldKey[] = ['title', 'description', 'currency', 'quantity'];
    if (input.condition) generatedFieldKeys.push('condition');
    if (input.proposedPrice !== undefined) generatedFieldKeys.push('price');
    if (input.size) generatedFieldKeys.push('size');
    if (input.color) generatedFieldKeys.push('color');
    if (input.material) generatedFieldKeys.push('material');
    if (input.model) generatedFieldKeys.push('model');

    return {
      source,
      fields: {
        title: buildFreeTitle(input),
        description: buildFreeDescription(input, photos.length),
        price: input.proposedPrice,
        // Product/ListingDraftFields have no workspace-level currency
        // setting anywhere in this codebase (ADKSY's own Product model has
        // no currency column at all — every price in the app is an
        // implicit EUR figure, see the system prompt's own € examples) —
        // defaulting to 'EUR' here matches that existing, platform-wide
        // assumption; it is never an invented business fact about THIS
        // item, only the same currency every other ADKSY price already is.
        currency: input.proposedCurrency ?? 'EUR',
        quantity: 1,
        condition: input.condition,
        size: input.size,
        color: input.color,
        material: input.material,
        model: input.model,
      },
      generatedFieldKeys,
      editedFieldKeys: [],
      originalValues: {},
    };
  }

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
      kind: 'sourced',
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
      // Opportunity Classification fix (Web Sourcing audit) — previously
      // dropped here even when the search result genuinely reported them
      // (NormalizedSourcingResult has carried `size`/`material` since the
      // Deep Web Sourcing Engine, and `color`/`qualityTier`/`classification`
      // since this fix) — never invented when absent on the result.
      size: result.size,
      color: result.color,
      material: result.material,
      availability: result.availability,
      productUrl: result.productUrl,
      pageType: result.pageType,
      qualityTier: result.qualityTier,
      classification: result.classification,
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
    // Opportunity Classification fix — pre-fill the editable field ONLY
    // when the source itself confidently reported it (same "never invent"
    // rule as `condition` above); absent on the result, the field stays
    // undefined and editable exactly as before this fix.
    if (result.size) generatedFieldKeys.push('size');
    if (result.color) generatedFieldKeys.push('color');
    if (result.material) generatedFieldKeys.push('material');

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
        size: result.size,
        color: result.color,
        material: result.material,
      },
      generatedFieldKeys,
      editedFieldKeys: [],
      originalValues: {},
    };
  }
}

export default ListingGenerationService;
