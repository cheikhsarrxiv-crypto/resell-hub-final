/**
 * Manual, local-only smoke test for TavilyWebSearchProvider (Global Web
 * Sourcing, Phase 2 PoC).
 *
 * NOT run automatically anywhere — not in CI, not in any npm script, not
 * in postinstall. Deliberately kept out of `src/` and out of the vitest
 * test suite (vitest.config.ts's own include patterns never touch
 * scripts/manual/) so it never accidentally runs as a "test" or spends
 * real Tavily credits during `npm test`.
 *
 * Requires a real TAVILY_API_KEY and outbound network access — run it
 * yourself, from an environment that has both:
 *
 *   TAVILY_API_KEY=tvly-... npx tsx scripts/manual/tavily-search-test.ts
 *
 * Runs the three real-world queries from the Phase 2 brief and prints
 * each raw WebSearchResult returned — nothing normalized, nothing
 * enriched, exactly what TavilyWebSearchProvider.search() itself returns.
 */
import { TavilyWebSearchProvider } from '@/services/websourcing/providers/TavilyWebSearchProvider';

const TEST_QUERIES = [
  'Louis Vuitton Nano Speedy between 200 and 300 EUR',
  'Nike Tech Fleece black size L under 80 EUR Europe',
  'vintage designer leather jacket under 150 EUR France Germany Italy',
];

async function main() {
  const provider = new TavilyWebSearchProvider();

  if (!provider.isConfigured()) {
    console.error('TAVILY_API_KEY is not set — nothing to test. Set it and re-run.');
    process.exitCode = 1;
    return;
  }

  for (const query of TEST_QUERIES) {
    console.log(`\n=== Query: "${query}" ===`);
    const outcome = await provider.search({ query, maxResults: 5 });

    if (outcome.error) {
      console.log(`  ERROR (${outcome.error.kind}): ${outcome.error.message}`);
      continue;
    }

    if (outcome.results.length === 0) {
      console.log('  No results.');
      continue;
    }

    for (const result of outcome.results) {
      console.log(`  - ${result.title}`);
      console.log(`    url: ${result.url}`);
      console.log(`    domain: ${result.domain ?? '(unparseable)'}`);
      console.log(`    score: ${result.score ?? '(not reported)'}`);
      console.log(`    publishedDate: ${result.publishedDate ?? '(not reported)'}`);
      console.log(`    content: ${result.content.slice(0, 160)}${result.content.length > 160 ? '…' : ''}`);
    }
  }
}

main().catch((error) => {
  console.error('Manual Tavily smoke test failed unexpectedly:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
