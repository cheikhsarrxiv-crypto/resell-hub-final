import { Button } from '@/components/UI/Button';
import Link from 'next/link';
import {
  ArrowRight,
  RefreshCw,
  PackageCheck,
  LineChart,
  Layers,
  ShoppingBag,
  TrendingUp,
  Clock,
} from 'lucide-react';

const MARKETPLACES = [
  { name: 'eBay', status: 'live' },
  { name: 'Vinted', status: 'soon' },
  { name: 'Depop', status: 'soon' },
  { name: 'Etsy', status: 'soon' },
];

const FEATURES = [
  {
    icon: Layers,
    title: 'Product catalog',
    description: 'Track every item you source — purchase price, selling price, stock, category — in one place.',
  },
  {
    icon: ShoppingBag,
    title: 'Listings on eBay',
    description: 'Turn a product into a live eBay listing with a title, description, price and quantity in a few clicks.',
  },
  {
    icon: RefreshCw,
    title: 'Order tracking',
    description: 'See every order as it comes in, filter by status, and follow it through to delivery.',
  },
  {
    icon: PackageCheck,
    title: 'Fulfillment',
    description: 'Send orders to a fulfillment partner and track cost, revenue and profit per shipment.',
  },
  {
    icon: LineChart,
    title: 'Analytics',
    description: 'Revenue trend, top products, and performance by marketplace — updated after every sale.',
  },
  {
    icon: TrendingUp,
    title: 'Margin, not just revenue',
    description: 'Every product and order shows real profit and margin, not just the price it sold for.',
  },
];

const BENEFITS = [
  {
    title: 'Stop juggling tabs',
    description: 'Manage your product, your eBay listing and the resulting order from the same dashboard.',
  },
  {
    title: 'Know your real margin',
    description: 'Purchase price vs. selling price is calculated automatically for every item you sell.',
  },
  {
    title: 'Hand off fulfillment when you need to',
    description: 'Route orders to a partner and keep visibility on cost and profit — without losing control.',
  },
];

const condensedPlans = [
  { name: 'Free', price: 0 },
  { name: 'Starter', price: 19 },
  { name: 'Pro', price: 49 },
  { name: 'Business', price: 99 },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
      <path
        d="M24 48 L36 22 L48 48 M29 39 H43"
        stroke={light ? 'white' : '#14161A'}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      {/* Intro animation — decorative, purely CSS, auto-dismisses after ~3.5s.
          aria-hidden because the real Hero content below is already in the
          DOM and remains reachable to assistive tech and no-JS/reduced-motion
          visitors throughout. */}
      <div className="intro-overlay" aria-hidden="true">
        <div className="flex flex-col items-center px-6 text-center">
          <div className="intro-symbol mb-4">
            <svg width="56" height="56" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
              <path
                d="M24 48 L36 22 L48 48 M29 39 H43"
                stroke="white"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </div>

          <div className="intro-wordmark font-display text-2xl sm:text-3xl font-bold text-white tracking-tight mb-10">
            ADKSY
          </div>

          <div className="intro-flow flex items-center gap-3 sm:gap-4">
            <div className="bg-white/5 border border-white/10 rounded-xl px-3 sm:px-4 py-3 text-left">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono mb-1">Product</p>
              <p className="text-xs sm:text-sm font-medium text-white whitespace-nowrap">Nike Air Max 90</p>
            </div>

            <div className="intro-line w-8 sm:w-12 h-px bg-white/15 flex-shrink-0" />

            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="7" />
                <path d="M25 47 L36 23 L47 47" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">ADKSY</span>
            </div>

            <div className="intro-line w-8 sm:w-12 h-px bg-white/15 flex-shrink-0" />

            <div className="bg-white/5 border border-[#FF5A1F]/40 rounded-xl px-3 sm:px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono mb-1">Marketplace</p>
              <p className="text-xs sm:text-sm font-medium text-[#FF5A1F] whitespace-nowrap">eBay</p>
            </div>
          </div>

          <div className="intro-status mt-6 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest bg-[#FF5A1F]/10 text-[#FF5A1F] border border-[#FF5A1F]/30 rounded-full px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF5A1F]" />
            Published
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex justify-between items-center px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-xl font-bold text-[#14161A] tracking-tight">
            ADKSY
          </span>
        </div>
        <div className="flex gap-3 items-center">
          <Link href="/login" className="text-sm font-medium text-[#14161A] hover:text-[#FF5A1F] transition-colors px-3">
            Sign in
          </Link>
          <Link href="/signup">
            <Button className="bg-[#14161A] text-white hover:bg-[#2a2d33] rounded-full px-5">
              Get started
            </Button>
          </Link>
        </div>
      </nav>

      {/* 1. Hero */}
      <section className="bg-[#14161A] text-white">
        <div className="max-w-6xl mx-auto px-6 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-6 border border-[#FF5A1F]/30 rounded-full px-3 py-1">
              Live on eBay · More marketplaces soon
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-bold leading-[1.05] mb-6">
              List it once.
              <br />
              Sell it <span className="text-[#FF5A1F]">everywhere.</span>
            </h1>
            <p className="text-lg text-gray-400 max-w-md mb-8 leading-relaxed">
              ADKSY is the hub for your reselling business — manage products, publish
              to eBay, and track orders, fulfillment and profit from one dashboard.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup">
                <Button className="bg-[#FF5A1F] text-white hover:bg-[#e64f18] rounded-full px-6 py-3 text-base">
                  Start free <ArrowRight className="w-4 h-4 ml-2 inline" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10 rounded-full px-6 py-3 text-base">
                  See pricing
                </Button>
              </Link>
            </div>
          </div>

          {/* Signature element */}
          <div className="relative">
            <div className="bg-white text-[#14161A] rounded-2xl p-5 shadow-2xl max-w-sm mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-lg bg-[#F0EEE8] flex items-center justify-center font-mono text-xs text-gray-400">
                  IMG
                </div>
                <div>
                  <p className="font-semibold text-sm leading-tight">Nike Air Max 90 — 42</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">SKU-NK-0042 · 89,00 €</p>
                </div>
              </div>
              <div className="h-px bg-gray-100 mb-4" />
              <p className="text-xs uppercase tracking-widest text-gray-400 font-mono mb-3">
                Published to
              </p>
              <div className="flex flex-wrap gap-2">
                {MARKETPLACES.map((m) => (
                  <span
                    key={m.name}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                      m.status === 'live'
                        ? 'text-[#FF5A1F] border-[#FF5A1F]'
                        : 'text-gray-400 border-[#E5E2DB] border-dashed'
                    }`}
                  >
                    {m.name}
                    {m.status === 'soon' && <span className="ml-1 text-[10px]">· soon</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. What ADKSY does */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3">
          What it does
        </p>
        <h2 className="font-display text-3xl font-bold text-[#14161A] mb-10">
          Three steps. One dashboard.
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-left">
          <div>
            <div className="font-display text-4xl font-bold text-[#FF5A1F] mb-2">01</div>
            <p className="font-semibold text-[#14161A] mb-1">Add your product</p>
            <p className="text-sm text-gray-600">Purchase price, selling price, stock — tracked from day one.</p>
          </div>
          <div>
            <div className="font-display text-4xl font-bold text-[#FF5A1F] mb-2">02</div>
            <p className="font-semibold text-[#14161A] mb-1">Publish to eBay</p>
            <p className="text-sm text-gray-600">Create a listing with your price and quantity, live in minutes.</p>
          </div>
          <div>
            <div className="font-display text-4xl font-bold text-[#FF5A1F] mb-2">03</div>
            <p className="font-semibold text-[#14161A] mb-1">Track the sale</p>
            <p className="text-sm text-gray-600">Order, fulfillment and real profit — all in the same place.</p>
          </div>
        </div>
      </section>

      {/* 3. Visual demo: product -> eBay */}
      <section className="bg-white border-y border-[#E5E2DB]">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3 text-center">
            From catalog to marketplace
          </p>
          <h2 className="font-display text-3xl font-bold text-[#14161A] mb-14 text-center">
            One product, published to eBay.
          </h2>
          <div className="flex flex-col md:flex-row items-center justify-center gap-6">
            <div className="bg-[#F7F6F2] border border-[#E5E2DB] rounded-2xl p-6 w-full max-w-xs">
              <p className="text-xs font-mono uppercase tracking-widest text-gray-400 mb-3">Product</p>
              <div className="w-full h-24 rounded-lg bg-[#E5E2DB] mb-3 flex items-center justify-center font-mono text-xs text-gray-400">
                IMG
              </div>
              <p className="font-semibold text-[#14161A]">Nike Air Max 90 — 42</p>
              <p className="text-xs text-gray-500 font-mono mt-1">Stock: 12 · Margin: 35%</p>
            </div>

            <ArrowRight className="w-8 h-8 text-[#FF5A1F] rotate-90 md:rotate-0 flex-shrink-0" />

            <div className="bg-[#14161A] rounded-2xl p-6 w-full max-w-xs text-white">
              <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3">eBay listing</p>
              <p className="font-semibold">Nike Air Max 90 — Taille 42</p>
              <p className="text-sm text-gray-400 mt-1">89,00 €</p>
              <span className="inline-block mt-3 text-[10px] font-mono uppercase tracking-wide bg-[#FF5A1F]/10 text-[#FF5A1F] px-2 py-1 rounded-full">
                Published
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4 & 5. Marketplace status */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3 text-center">
          Marketplaces
        </p>
        <h2 className="font-display text-3xl font-bold text-[#14161A] mb-3 text-center">
          eBay is live today.
        </h2>
        <p className="text-gray-600 text-center mb-14 max-w-lg mx-auto">
          Vinted, Depop and Etsy are on our roadmap — not yet available.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-[#FF5A1F] rounded-xl p-5 text-center">
            <p className="font-display font-bold text-[#14161A] mb-2">eBay</p>
            <span className="text-[10px] font-mono uppercase tracking-wide bg-[#FF5A1F]/10 text-[#FF5A1F] px-2 py-1 rounded-full">
              Active
            </span>
          </div>
          {['Vinted', 'Depop', 'Etsy'].map((name) => (
            <div key={name} className="bg-white border border-dashed border-[#E5E2DB] rounded-xl p-5 text-center opacity-70">
              <p className="font-display font-bold text-gray-400 mb-2">{name}</p>
              <span className="text-[10px] font-mono uppercase tracking-wide bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
                Coming soon
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 6. Features */}
      <section className="bg-white border-y border-[#E5E2DB]">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3">
            Features
          </p>
          <h2 className="font-display text-3xl font-bold text-[#14161A] mb-14 max-w-lg">
            Everything between &ldquo;sourced it&rdquo; and &ldquo;shipped it.&rdquo;
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {FEATURES.map((f) => (
              <div key={f.title} className="border-t-2 border-[#14161A] pt-5">
                <f.icon className="w-6 h-6 text-[#FF5A1F] mb-4" />
                <h3 className="font-display font-bold text-[#14161A] mb-2">{f.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Benefits */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3 text-center">
          Why resellers use ADKSY
        </p>
        <h2 className="font-display text-3xl font-bold text-[#14161A] mb-14 text-center">
          Built around how you actually work.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {BENEFITS.map((b) => (
            <div key={b.title} className="text-center">
              <h3 className="font-semibold text-[#14161A] mb-2">{b.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 8. Dashboard preview */}
      <section className="bg-[#14161A]">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3 text-center">
            Inside ADKSY
          </p>
          <h2 className="font-display text-3xl font-bold text-white mb-14 text-center">
            One dashboard for the whole flow.
          </h2>
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-[#F7F6F2] border-b border-[#E5E2DB] px-6 py-3 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              <span className="ml-3 text-xs text-gray-400 font-mono">adksy.io/dashboard</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
              <div className="bg-[#F7F6F2] rounded-lg p-4">
                <p className="text-xs text-gray-500">Revenue</p>
                <p className="font-display font-bold text-[#14161A] text-lg mt-1">4 285,00 €</p>
              </div>
              <div className="bg-[#F7F6F2] rounded-lg p-4">
                <p className="text-xs text-gray-500">Orders</p>
                <p className="font-display font-bold text-[#14161A] text-lg mt-1">142</p>
              </div>
              <div className="bg-[#F7F6F2] rounded-lg p-4">
                <p className="text-xs text-gray-500">Profit</p>
                <p className="font-display font-bold text-[#14161A] text-lg mt-1">1 612,50 €</p>
              </div>
              <div className="bg-[#F7F6F2] rounded-lg p-4">
                <p className="text-xs text-gray-500">Margin</p>
                <p className="font-display font-bold text-[#14161A] text-lg mt-1">37.6%</p>
              </div>
            </div>
            <p className="text-center text-xs text-gray-400 pb-6">Illustrative data for preview purposes</p>
          </div>
        </div>
      </section>

      {/* 9. Pricing (condensed) */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3 text-center">
          Pricing
        </p>
        <h2 className="font-display text-3xl font-bold text-[#14161A] mb-14 text-center">
          Simple, transparent pricing.
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {condensedPlans.map((plan) => (
            <div key={plan.name} className="bg-white border border-[#E5E2DB] rounded-xl p-5 text-center">
              <p className="font-semibold text-[#14161A] mb-2">{plan.name}</p>
              <p className="font-display text-2xl font-bold text-[#14161A]">
                {plan.price === 0 ? 'Free' : `${plan.price.toFixed(0)}€`}
              </p>
              {plan.price > 0 && <p className="text-xs text-gray-500">/month</p>}
            </div>
          ))}
        </div>
        <div className="text-center">
          <Link href="/pricing">
            <Button variant="outline" className="border-[#14161A] text-[#14161A] hover:bg-[#14161A] hover:text-white rounded-full px-6">
              View full pricing
            </Button>
          </Link>
        </div>
      </section>

      {/* 10. FAQ */}
      <section className="bg-white border-t border-[#E5E2DB]">
        <div className="max-w-3xl mx-auto px-6 py-20">
          <h2 className="font-display text-3xl font-bold text-[#14161A] mb-12 text-center">
            Frequently asked questions
          </h2>
          <div className="space-y-8">
            {[
              {
                q: 'Which marketplaces can I sell on right now?',
                a: 'eBay is fully supported today. Vinted, Depop and Etsy are on our roadmap and not yet available.',
              },
              {
                q: 'Do I need a credit card to start?',
                a: 'No. The Free plan requires no credit card — upgrade whenever you need more products or listings.',
              },
              {
                q: 'Can I change my plan anytime?',
                a: 'Yes, you can upgrade or downgrade at any time from your account settings.',
              },
              {
                q: 'Does ADKSY handle fulfillment?',
                a: 'You can route orders to a fulfillment partner and track cost, revenue and profit — available from the Pro plan.',
              },
            ].map((faq, idx) => (
              <div key={idx}>
                <h3 className="font-semibold text-[#14161A] mb-2">{faq.q}</h3>
                <p className="text-gray-600 text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 11. Final CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="bg-[#14161A] rounded-2xl px-10 py-16 text-center">
          <h2 className="font-display text-3xl font-bold text-white mb-4">
            Your next sale is one listing away.
          </h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            Free to start. No credit card required.
          </p>
          <Link href="/signup">
            <Button className="bg-[#FF5A1F] text-white hover:bg-[#e64f18] rounded-full px-8 py-3 text-base">
              Create your account
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#E5E2DB] py-10 text-center text-sm text-gray-500">
        <p>&copy; 2026 ADKSY. All rights reserved.</p>
      </footer>
    </div>
  );
}
