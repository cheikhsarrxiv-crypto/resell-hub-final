/**
 * EtsyListingMapper
 *
 * Derives the three Etsy-required listing fields (who_made, when_made,
 * taxonomy_id) from real Product data, replacing the hardcoded placeholders
 * that previously lived inside EtsyAdapter.createListing
 * (who_made: 'someone_else', when_made: 'made_to_order', taxonomy_id: 1).
 *
 * DESIGN NOTE — why there is no year -> when_made inference here:
 * An earlier version of this file asked sellers for a numeric
 * `productionYear` and computed the when_made bucket from it. That was
 * dropped in favor of having the seller pick the real Etsy era bucket
 * directly (Product.etsyWhenMade), for two reasons found while re-checking
 * Etsy's own request schema:
 *  1. `when_made`'s own field description says it exists to help buyers
 *     find the listing under Etsy's "Vintage" heading — it's a coarse,
 *     buyer-facing discoverability bucket, not a precise fact ADKSY needs
 *     to compute. There is no reason to introduce a derived value where
 *     Etsy's own vocabulary is the more honest, more direct one to store.
 *  2. Computing a bucket from a year requires guessing at boundaries for
 *     years the verified enum doesn't clearly cover (e.g. 2026+), and at
 *     how to resolve `before_2006` overlapping `2000_2005`/`2006_2009`.
 *     Storing the seller's own bucket choice directly removes both
 *     problems: there is nothing to infer, so nothing to get wrong.
 *
 * SOURCE OF THE who_made/when_made/taxonomy_id REQUIREMENT (verified, not
 * guessed): developer.etsy.com/etsy.com are egress-blocked in this
 * sandbox, so this was verified against Etsy's own published OpenAPI v3
 * spec, retrieved via a shallow git clone of
 * https://github.com/Crazyglue/etsy-v3-sdk (a generated client that
 * vendors the spec verbatim as etsy-v3-openapi.json). Checked directly
 * against the real `createDraftListing` request body schema
 * (POST /v3/application/shops/{shop_id}/listings), not just a generic
 * component schema:
 *   - `required: [quantity, title, description, price, who_made,
 *     when_made, taxonomy_id]` — Etsy's API rejects a listing missing any
 *     of these; there is no "unknown"/omit option for when_made.
 *   - `when_made` enum: made_to_order, 2020_2025, 2010_2019, 2006_2009,
 *     before_2006, 2000_2005, 1990s, 1980s, 1970s, 1960s, 1950s, 1940s,
 *     1930s, 1920s, 1910s, 1900s, 1800s, 1700s, before_1700.
 *   - `who_made` enum: i_did, someone_else, collective.
 * That spec file's license header reads "Etsy Open API v3 ... version
 * 3.0.0, copyright 2021-2025 Etsy, Inc." — i.e. current through 2025, not
 * a live fetch at the time this was written (September 2026). Spot-check
 * against a real draft listing before relying on this in production.
 */

// Etsy's who_made is one of three real seller-declared values
// (i_did / someone_else / collective). ADKSY is exclusively a resale
// platform — sellers are never the maker — so this is a fixed, documented
// business rule rather than a per-product field. Known limitation: a
// seller reselling something they personally made would be misclassified;
// out of scope for this first version per explicit product decision.
export const ETSY_WHO_MADE = 'someone_else' as const;

// The exact, verified when_made enum Etsy's createDraftListing accepts
// today (see file header for the source). Exposed as {value,label} pairs
// so the product form can render it directly — no arithmetic, no
// inference, no default. If Etsy changes this list, update it here only.
export const ETSY_WHEN_MADE_OPTIONS: { value: string; label: string }[] = [
  { value: 'made_to_order', label: 'Made to order' },
  { value: '2020_2025', label: '2020–2025' },
  { value: '2010_2019', label: '2010–2019' },
  { value: '2006_2009', label: '2006–2009' },
  { value: '2000_2005', label: '2000–2005' },
  { value: 'before_2006', label: 'Before 2006 (exact years unknown)' },
  { value: '1990s', label: '1990s' },
  { value: '1980s', label: '1980s' },
  { value: '1970s', label: '1970s' },
  { value: '1960s', label: '1960s' },
  { value: '1950s', label: '1950s' },
  { value: '1940s', label: '1940s' },
  { value: '1930s', label: '1930s' },
  { value: '1920s', label: '1920s' },
  { value: '1910s', label: '1910s' },
  { value: '1900s', label: '1900s' },
  { value: '1800s', label: '1800s' },
  { value: '1700s', label: '1700s' },
  { value: 'before_1700', label: 'Before 1700' },
];

const VALID_WHEN_MADE_VALUES = new Set(ETSY_WHEN_MADE_OPTIONS.map((o) => o.value));

export function isValidEtsyWhenMade(value: string): boolean {
  return VALID_WHEN_MADE_VALUES.has(value);
}

export interface EtsyListingRequirements {
  taxonomyId: number;
  whenMade: string;
  whoMade: typeof ETSY_WHO_MADE;
}

/**
 * Builds the three Etsy-required fields from a product, or throws with a
 * specific, actionable message identifying exactly what's missing/invalid.
 * Never invents a taxonomyId or a whenMade bucket — both must already be
 * set on the product (by the seller, via the product form) or this
 * throws, which ListingService turns into a per-marketplace publish
 * failure (Etsy only; other marketplaces are unaffected).
 */
export function buildEtsyListingRequirements(product: {
  etsyTaxonomyId: number | null | undefined;
  etsyWhenMade: string | null | undefined;
}): EtsyListingRequirements {
  if (product.etsyTaxonomyId == null) {
    throw new Error(
      'EtsyListingMapper: this product has no Etsy category (etsyTaxonomyId) set. Set one before publishing to Etsy — no generic fallback category is used.'
    );
  }

  if (product.etsyWhenMade == null) {
    throw new Error(
      'EtsyListingMapper: this product has no Etsy "when made" era set. Etsy requires this on every listing — select one before publishing to Etsy. No default is assumed.'
    );
  }

  if (!isValidEtsyWhenMade(product.etsyWhenMade)) {
    throw new Error(
      `EtsyListingMapper: "${product.etsyWhenMade}" is not a value Etsy's when_made currently accepts. Re-check Etsy's accepted values before publishing.`
    );
  }

  return {
    taxonomyId: product.etsyTaxonomyId,
    whenMade: product.etsyWhenMade,
    whoMade: ETSY_WHO_MADE,
  };
}
