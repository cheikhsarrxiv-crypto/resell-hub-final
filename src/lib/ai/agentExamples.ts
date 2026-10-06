/**
 * Shared source of truth for the Agent IA welcome screen's 7 example
 * requests — used by both the composer's rotating placeholder
 * (AgentComposer.tsx) and the static "Exemples de demandes" card list
 * (AgentMessageList.tsx), so the two never drift out of sync.
 *
 * Deliberately spans several product categories (sneakers, furniture,
 * electronics, gaming, photo, fashion listing creation) so the examples
 * themselves demonstrate the Agent is not fashion-only — see the Phase
 * D/E read-only audits on search_products universality.
 */
export const AGENT_EXAMPLE_PROMPTS = [
  'Trouve-moi une Air Force 1 taille 43 à moins de 100 €',
  'Trouve-moi une table moderne à moins de 150 €',
  'Trouve-moi un MacBook Air M2 à moins de 700 €',
  'Trouve-moi une PS5 d’occasion au meilleur prix',
  'Trouve-moi une caméra Sony à moins de 800 €',
  'Crée-moi une annonce pour cette veste',
  'Trouve-moi une chaise de bureau confortable à moins de 200 €',
];

/**
 * Same 7 examples, shorter — on a ~390px phone the composer's actual text
 * area is only ~220px wide (outer padding + the send button + the
 * field's own padding all eat into the 390px viewport), where the full
 * sentences above visibly truncate mid-word. Used only by the composer's
 * rotating overlay below the `sm` breakpoint (see the two overlay spans
 * in AgentComposer.tsx) — the static example cards wrap naturally
 * instead, so they don't need a short variant.
 */
export const AGENT_EXAMPLE_PROMPTS_SHORT = [
  'Air Force 1 — taille 43 — moins de 100 €',
  'Table moderne — moins de 150 €',
  'MacBook Air M2 — moins de 700 €',
  'PS5 d’occasion — meilleur prix',
  'Caméra Sony — moins de 800 €',
  'Crée une annonce pour cette veste',
  'Chaise de bureau — moins de 200 €',
];
