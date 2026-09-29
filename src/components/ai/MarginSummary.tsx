import type { MarginCalculationResult } from '@/services/pricing/types';
import { certaintyPrefix, describeCostType, describeMissingData, formatMarginAmount, formatMarginPercent } from '@/lib/ai/marginResults';

interface MarginSummaryProps {
  result: MarginCalculationResult;
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{label}</span>
      <span className="text-base font-semibold text-white truncate">{value}</span>
    </div>
  );
}

/**
 * Purely presentational — every number here is read as-is from
 * MarginCalculationResult (already fully computed and rounded by
 * PricingService). No subtraction, division, multiplication, or
 * currency conversion happens in this component.
 */
export function MarginSummary({ result }: MarginSummaryProps) {
  const noProfitFigures = result.netProfit === null && result.marginPercent === null && result.roi === null;
  const resaleMissing = result.missingData.includes('resalePrice');

  return (
    <div className="flex flex-col bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 sm:p-5 gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Analyse de rentabilité</h3>
        {result.isEstimate && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20 shrink-0">
            Estimation
          </span>
        )}
      </div>

      {noProfitFigures ? (
        <p className="text-sm text-gray-400 italic">
          {resaleMissing ? 'Prix de revente manquant — seul le coût a été calculé.' : 'Calcul partiel — certaines données sont manquantes.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Bénéfice net" value={result.netProfit !== null ? formatMarginAmount(result.netProfit, result.currency) : '—'} />
          <Stat label="Marge" value={result.marginPercent !== null ? formatMarginPercent(result.marginPercent) : '—'} />
          <Stat label="ROI" value={result.roi !== null ? formatMarginPercent(result.roi) : '—'} />
        </div>
      )}

      {result.totalCost !== null && (
        <p className="text-sm text-gray-300">
          Coût total : <span className="font-medium text-white">{formatMarginAmount(result.totalCost, result.currency)}</span>
        </p>
      )}

      {result.costBreakdown.length > 0 && (
        <div className="border-t border-white/[0.06] pt-3">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Détail des coûts</p>
          <ul className="space-y-1.5">
            {/* Rendered in exactly the order PricingService returned them — never re-sorted. */}
            {result.costBreakdown.map((line, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm text-gray-300">
                <span className="truncate" title={line.description}>
                  {describeCostType(line.type)}
                </span>
                <span className="shrink-0 font-medium text-white">
                  {certaintyPrefix(line.source)}
                  {formatMarginAmount(line.amount, line.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.missingData.length > 0 && (
        <div className="border-t border-white/[0.06] pt-3">
          <ul className="space-y-1">
            {result.missingData.map((entry) => (
              <li key={entry} className="text-xs text-amber-400/90">
                {describeMissingData(entry)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default MarginSummary;
