/**
 * Global Sourcing Engine — Query Expansion.
 *
 * Deliberately a pure, unwired structural stub. Nothing in this codebase
 * calls this service yet — SourcingService.search() and search_products
 * pass NormalizedSearchQuery.query straight through to each provider,
 * exactly as before this task. The task's own spec permits exactly this
 * ("pas d'implémentation automatique de traduction") when no safe minimal
 * implementation exists: real query expansion (translating "sneakers" to
 * "baskets"/"scarpe da ginnastica", or expanding brand synonyms) would
 * require either a translation provider ADKSY has no verified access to,
 * or a hand-maintained dictionary that would itself be a fabricated data
 * source — neither is available today, so this stays a no-op.
 *
 * The interface exists so a real implementation (a real translation API,
 * once ADKSY has legitimate access to one) can be substituted later
 * without SourcingService or any tool changing shape.
 */
export interface QueryExpansionResult {
  original: string;
  /** Always empty for NoopQueryExpansionService — see class comment. */
  variants: string[];
}

export interface QueryExpansionService {
  expand(query: string): Promise<QueryExpansionResult>;
}

/**
 * The only implementation today. Returns the original query unchanged,
 * with no variants — never a guessed translation or synonym.
 */
export class NoopQueryExpansionService implements QueryExpansionService {
  async expand(query: string): Promise<QueryExpansionResult> {
    return { original: query, variants: [] };
  }
}

export default NoopQueryExpansionService;
