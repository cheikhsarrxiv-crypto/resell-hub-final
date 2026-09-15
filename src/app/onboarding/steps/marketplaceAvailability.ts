/**
 * Only eBay and Etsy have a working OAuth connection today — see
 * SUPPORTED_MARKETPLACES in the connect route. Vinted/Depop/Vestiaire
 * Collective each have a real seller API, but access is gated behind an
 * official partnership/allowlist we don't have yet (verified directly
 * against each platform's own docs, not assumed) — they are shown as
 * "waiting on partner access", never as an equal, selectable option, so
 * onboarding never implies a connection that can't happen.
 *
 * Kept in its own plain (non-JSX) module so it stays importable from a
 * vitest test without JSX transform issues (this project's tsconfig uses
 * `jsx: "preserve"`, which Vite's default test transform can't parse
 * directly) — MarketplacesStep.tsx just re-uses these two lists.
 */
export const availableMarketplaces = [
  { id: 'ebay', name: 'eBay', description: 'Largest e-commerce marketplace' },
  { id: 'etsy', name: 'Etsy', description: 'Handmade and vintage items' },
];

export const comingSoonMarketplaces = [
  { id: 'vinted', name: 'Vinted', description: 'Popular for fashion and second-hand' },
  { id: 'depop', name: 'Depop', description: 'Fashion-focused social marketplace' },
  { id: 'vestiaire-collective', name: 'Vestiaire Collective', description: 'Pre-owned luxury fashion' },
];
