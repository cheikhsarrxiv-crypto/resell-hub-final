/**
 * Phase 12A — renders an AgentAction's `summary` exactly as the backend
 * computed it (AiActionService/tool.preview) — never re-derived,
 * recalculated, or embellished here. Purely presentational, same pattern
 * as MarginSummary/SourcingResultCard: plain React text children only,
 * never dangerouslySetInnerHTML, so a seller/marketplace-sourced string
 * (e.g. a listing title) can never inject markup.
 */

// Keys that are structural/internal rather than something to show the
// reseller as a labeled field — either rendered separately (message,
// error) or not meaningful on their own (action, confirmationRequired).
const HIDDEN_KEYS = new Set(['action', 'confirmationRequired', 'message', 'error', 'simulatedOnly']);

const FIELD_LABELS: Record<string, string> = {
  listingId: 'Annonce',
  title: 'Titre',
  marketplace: 'Marketplace',
  marketplaceConnected: 'Marketplace connectée',
  currentStatus: 'Statut actuel',
  note: 'Note',
  // Phase 4 — create_product's own preview (buildProductPreview in
  // actionTools.ts) uses these exact keys; every other 'engage' tool's
  // preview keys already had a label above or fall through to
  // humanizeKey(), unaffected by this addition.
  sourceMarketplace: 'Source',
  sourceId: 'Identifiant source',
  sourceUrl: 'Lien de la source',
  description: 'Description',
  sellingPrice: 'Prix de vente proposé',
  purchasePrice: "Prix d'achat",
  sku: 'SKU',
  brand: 'Marque',
  condition: 'État',
  size: 'Taille',
  color: 'Couleur',
};

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  // The one structured shape every 'engage' tool preview may use today
  // (see publish_listing's own preview) — {amount, currency}.
  if (
    typeof value === 'object' &&
    'amount' in (value as Record<string, unknown>) &&
    'currency' in (value as Record<string, unknown>)
  ) {
    const v = value as { amount: unknown; currency: unknown };
    return `${v.amount} ${v.currency}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface AgentActionPreviewProps {
  summary: Record<string, unknown>;
}

export function AgentActionPreview({ summary }: AgentActionPreviewProps) {
  const entries = Object.entries(summary).filter(([key]) => !HIDDEN_KEYS.has(key));
  const note = typeof summary.message === 'string' ? summary.message : undefined;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-sm">
      {entries.length > 0 && (
        <dl className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-500">{FIELD_LABELS[key] ?? humanizeKey(key)}</dt>
              <dd className="text-gray-200 text-right break-words">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className="mt-2 text-xs text-gray-500">{note}</p>}
    </div>
  );
}

export default AgentActionPreview;
