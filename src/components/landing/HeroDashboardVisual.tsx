import type { ComponentType, ReactNode, SVGProps } from 'react';
import { EbayLogo, EtsyLogo, VintedLogo } from './MarketplaceLogos';

/**
 * Marketplace automation status mirrors the real OAuth integrations in
 * src/app/api/marketplace/connect/[marketplace]/route.ts and the adapters
 * under src/services/marketplace/adapters/: eBay and Etsy are real, live
 * integrations; Depop and Vinted are not yet available. Keep "live" vs
 * "soon" honest here — this is marketing copy, not the real dashboard.
 *
 * Depop has no official logo asset vendored in this project yet (it isn't
 * in simple-icons and this environment can't reach Depop's press kit), so
 * it stays a text badge rather than risk an inaccurate/invented mark.
 */
const MARKETPLACE_CHIPS: {
  label: string;
  status: 'live' | 'soon';
  position: string;
  logo?: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { label: 'eBay', status: 'live', position: 'top-[2%] left-[0%] sm:left-[4%]', logo: EbayLogo },
  { label: 'Etsy', status: 'live', position: 'top-[8%] right-[0%] sm:right-[2%]', logo: EtsyLogo },
  { label: 'Depop', status: 'soon', position: 'bottom-[16%] left-[0%]' },
  { label: 'Vinted', status: 'soon', position: 'bottom-[4%] right-[2%] sm:right-[6%]', logo: VintedLogo },
];

const RECENT_ORDERS: { item: string; marketplace: string; price: string; status: 'shipped' | 'pending' }[] = [
  { item: 'Sneakers', marketplace: 'eBay', price: '€120', status: 'shipped' },
  { item: 'Vinyl record', marketplace: 'Etsy', price: '€28', status: 'pending' },
  { item: 'Denim jacket', marketplace: 'eBay', price: '€64', status: 'shipped' },
];

function MarketplaceChip({
  label,
  status,
  position,
  logo: Logo,
}: {
  label: string;
  status: 'live' | 'soon';
  position: string;
  logo?: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  // Wordmark logos (eBay, Etsy) need real size to stay legible — a tile,
  // not a text-height pill. Depop has no logo asset yet, so it keeps the
  // original text pill rather than an empty or fake icon.
  if (Logo) {
    return (
      <div
        className={`absolute ${position} w-10 h-10 sm:w-12 sm:h-12 rounded-lg border flex items-center justify-center ${
          status === 'live'
            ? 'bg-[#0d0e11] border-white/15 text-gray-100'
            : 'bg-[#0d0e11] border-white/10 border-dashed text-gray-500'
        }`}
      >
        <Logo className="w-6 h-6 sm:w-7 sm:h-7" />
        {status === 'live' && (
          <span
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#FF5A1F] ring-2 ring-[#0d0e11]"
            aria-hidden="true"
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`absolute ${position} flex items-center gap-1.5 rounded-full border px-2.5 py-1 sm:px-3 sm:py-1.5 whitespace-nowrap ${
        status === 'live'
          ? 'bg-[#0d0e11] border-white/15 text-gray-100'
          : 'bg-[#0d0e11] border-white/10 border-dashed text-gray-500'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-[#FF5A1F]' : 'bg-gray-600'}`}
        aria-hidden="true"
      />
      <span className="text-[10px] sm:text-xs font-medium">{label}</span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <p className="text-[9px] sm:text-[10px] uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className="text-sm sm:text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: 'shipped' | 'pending' }) {
  return (
    <span
      className={`text-[9px] sm:text-[10px] font-medium px-1.5 py-0.5 rounded ${
        status === 'shipped' ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]' : 'bg-white/[0.06] text-gray-400'
      }`}
    >
      {status === 'shipped' ? 'Shipped' : 'Pending'}
    </span>
  );
}

export function HeroDashboardVisual(): ReactNode {
  return (
    <div className="relative w-full min-h-[380px] sm:min-h-[440px] lg:min-h-[520px] px-9 sm:px-12">
      {/* Very faint orbit ring — decorative only, no glow/blur */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 400 400"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <ellipse cx="200" cy="200" rx="168" ry="148" fill="none" stroke="rgba(255,90,31,0.10)" strokeWidth="1" />
      </svg>

      {/* Dashboard mockup card — illustrative sample data, not live figures */}
      <div
        className="landing-float relative mx-auto w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[360px] rounded-2xl border border-white/10 bg-[#0d0e11] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] p-4 sm:p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FF5A1F]" aria-hidden="true" />
            <span className="text-xs font-medium text-gray-300">ADKSY Dashboard</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-gray-600 font-mono uppercase tracking-wide">Sample</span>
        </div>

        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Revenue this month</p>
        <p className="font-bold text-white mb-3" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>
          &euro;24,560
        </p>

        <svg className="w-full h-10 mb-4" viewBox="0 0 260 40" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            points="0,32 30,28 60,30 90,20 120,22 150,14 180,16 210,8 240,10 260,4"
            fill="none"
            stroke="#FF5A1F"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <StatTile label="Orders" value="87" />
          <StatTile label="Listings" value="58" />
          <StatTile label="Markets" value="2" />
        </div>

        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Recent orders</p>
        <div className="space-y-1.5">
          {RECENT_ORDERS.map((order) => (
            <div key={order.item} className="flex items-center justify-between text-xs">
              <span className="text-gray-300 truncate">
                {order.item} <span className="text-gray-600">&middot; {order.marketplace}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0 pl-2">
                <span className="text-gray-400">{order.price}</span>
                <StatusPill status={order.status} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {MARKETPLACE_CHIPS.map((chip) => (
        <MarketplaceChip
          key={chip.label}
          label={chip.label}
          status={chip.status}
          position={chip.position}
          logo={chip.logo}
        />
      ))}
    </div>
  );
}
