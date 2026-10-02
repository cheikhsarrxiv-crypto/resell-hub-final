/**
 * Manual, local-only REAL integration test for the Deep Web Sourcing
 * Engine (mission section 21) — exercises the full real pipeline:
 * WebSearchQueryPlanner -> TavilyWebSearchProvider -> WebResultExtractionService
 * -> WebSourcingProvider -> SourcingService, exactly as search_products
 * calls it, for the query "Nike Air Max second hand under 50 EUR".
 *
 * NOT run automatically anywhere — not in CI, not in any npm script, not
 * in postinstall (same convention as tavily-search-test.ts). Requires
 * BOTH real API keys and outbound network access:
 *
 *   TAVILY_API_KEY=tvly-... ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/manual/tavily-deep-search-test.ts
 *
 * Prints, for manual inspection:
 *  - which passes actually ran (and which were skipped, and why)
 *  - raw Tavily hits per pass
 *  - extracted offers per candidate (including rejected ones, with the
 *    reason they were rejected)
 *  - final NormalizedSourcingResult objects: source, price, currency,
 *    availability, quality tier, opportunity score, warnings
 *  - the diagnostics object (zero/low-result provenance)
 *
 * Never prints TAVILY_API_KEY/ANTHROPIC_API_KEY or any other secret.
 */
import { SourcingService } from '@/services/sourcing/SourcingService';

const QUERY = {
  query: 'Nike Air Max',
  condition: 'used' as const,
  maxPrice: 50,
  currency: 'EUR',
  providers: ['web'] as const,
  deepSearch: true,
};

async function main() {
  const missing: string[] = [];
  if (!process.env.TAVILY_API_KEY) missing.push('TAVILY_API_KEY');
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(', ')} — nothing to test. Set them and re-run.`);
    process.exitCode = 1;
    return;
  }

  console.log(`=== Deep Web Sourcing Engine — real integration test ===`);
  console.log(`Query: ${JSON.stringify(QUERY)}\n`);

  const response = await SourcingService.search(QUERY as any);

  console.log(`Status: ${response.status}`);
  console.log(`Providers searched: ${response.providersSearched.join(', ') || '(none)'}`);
  console.log(`Provider errors: ${JSON.stringify(response.providerErrors)}`);
  console.log(`\n--- Diagnostics (zero/low-result provenance) ---`);
  console.log(JSON.stringify(response.diagnostics, null, 2));

  console.log(`\n--- Final results (${response.results.length}) ---`);
  for (const r of response.results) {
    console.log(`\n[${r.searchPass ?? 'n/a'} pass, query="${r.foundByQuery ?? 'n/a'}"]`);
    console.log(`  ${r.title}`);
    console.log(`  price: ${r.price} ${r.currency}${r.normalizedPriceEur !== undefined ? ` (~€${r.normalizedPriceEur.toFixed(2)})` : ''}`);
    console.log(`  availability: ${r.availability ?? '(not reported)'}`);
    console.log(`  pageType: ${r.pageType ?? 'n/a'}  qualityTier: ${r.qualityTier ?? 'n/a'}  opportunityScore: ${r.opportunityScore ?? 'n/a'}`);
    console.log(`  scoreFactors: ${JSON.stringify(r.scoreFactors ?? [])}`);
    console.log(`  verificationStatus: ${r.verificationStatus ?? 'n/a'}`);
    console.log(`  sourceUrl: ${r.sourceUrl}${r.productUrl ? ` (productUrl: ${r.productUrl})` : ''}`);
    console.log(`  warnings: ${JSON.stringify(r.warnings ?? [])}`);
  }

  if (response.results.length === 0) {
    console.log('\nNo exploitable offers found — see diagnostics above for exactly why (zero raw hits, extraction found nothing usable, price-bound exclusion, etc.), never a silent "no results".');
  }
}

main().catch((error) => {
  console.error('Manual Deep Web Sourcing Engine integration test failed unexpectedly:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
