import Link from 'next/link';
import { ArrowRight, Layers, ShoppingBag, RefreshCw, PackageCheck } from 'lucide-react';
import { LandingNav } from '@/components/landing/LandingNav';
import { HeroOrb } from '@/components/landing/HeroOrb';
import { HeroStage } from '@/components/landing/HeroStage';
import { Reveal } from '@/components/landing/Reveal';
import { displayFont as display, bodyFont as body } from '@/lib/fonts';

// Marketplace automation status reflects the real OAuth integrations wired
// up in src/app/api/marketplace/connect/[marketplace]/route.ts and the
// adapters in src/services/marketplace/adapters/ — eBay is a real, fully
// wired live integration. Etsy is also real and live, but its listing
// flow still uses placeholder taxonomy fields (see EtsyAdapter.ts) and
// production usage depends on Etsy's own commercial app review, so it
// must not be presented as equally production-ready as eBay. Depop is a
// documented placeholder blocked on partner approval; Vinted has no
// public API and is intentionally blocked.
// Never present a marketplace as automated unless it actually is.
const MARKETPLACES = [
  { name: 'eBay', status: 'live' as const, badge: 'Automated' },
  { name: 'Etsy', status: 'live' as const, badge: 'In review' },
  { name: 'Depop', status: 'soon' as const, badge: 'Coming soon' },
  { name: 'Vinted', status: 'soon' as const, badge: 'Coming soon' },
];

const HOW_IT_WORKS = [
  { n: '01', title: 'Find', desc: 'Source what you’re going to resell and log it in your catalog — purchase price, stock, condition.' },
  { n: '02', title: 'Analyze', desc: 'See real margin and profit on every item before you commit to listing it.' },
  { n: '03', title: 'List', desc: 'Publish a listing to eBay or Etsy with your price and quantity, live in minutes.' },
  { n: '04', title: 'Sell', desc: 'Orders sync automatically as they come in, from every connected marketplace.' },
  { n: '05', title: 'Fulfill', desc: 'Send the order to your fulfillment partner in one click, then track cost, revenue and profit automatically.' },
];

const FEATURES = [
  {
    icon: Layers,
    title: 'Product catalog',
    desc: 'Every item you source — purchase price, selling price, stock — tracked in one place.',
  },
  {
    icon: ShoppingBag,
    title: 'Multi-marketplace listings',
    desc: 'Turn one product into live listings on eBay and Etsy without re-entering anything.',
  },
  {
    icon: RefreshCw,
    title: 'Order sync',
    desc: 'Every order, from every connected marketplace, in one queue you can filter and track.',
  },
  {
    icon: PackageCheck,
    title: 'Fulfillment & margin',
    desc: 'Route orders to a partner and see real profit — not just the price it sold for.',
  },
];

const PLANS = [
  { name: 'Starter', price: 19, blurb: 'Up to 500 orders / month' },
  { name: 'Pro', price: 49, blurb: 'Up to 2,000 orders / month', highlighted: true },
  { name: 'Business', price: 99, blurb: 'Up to 10,000 orders / month' },
];

export default function Home() {
  return (
    <div className={`${display.variable} ${body.variable} bg-[#08080a] text-white overflow-x-clip`} style={{ fontFamily: 'var(--font-body)' }}>
      <LandingNav />

      {/* ============ HERO ============ */}
      <section className="relative min-h-screen flex flex-col justify-center px-6 pt-32 pb-16 overflow-hidden">
        {/* Faint vignette texture instead of a flat black fill */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(80% 60% at 50% 0%, rgba(255,255,255,0.05), transparent 60%), radial-gradient(60% 50% at 85% 30%, rgba(255,90,31,0.06), transparent 60%)',
          }}
          aria-hidden="true"
        />

        <HeroStage>
          <div className="hero-zoom relative max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-16 items-center">
            <div className="hero-fade">
              <Reveal>
                <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gray-400 mb-6">
                  The reselling operating system
                </p>
              </Reveal>

              <h1
                className="font-bold leading-[0.95] mb-8"
                style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.75rem, 7vw, 5.5rem)' }}
              >
                <Reveal delayMs={80}>
                  <span className="block text-white">Sell</span>
                </Reveal>
                <Reveal delayMs={160}>
                  <span className="block text-gray-500">Everywhere.</span>
                </Reveal>
                <Reveal delayMs={280}>
                  <span className="block text-white">From One Place.</span>
                </Reveal>
              </h1>

              <Reveal delayMs={420}>
                <p className="text-gray-400 text-base sm:text-lg max-w-md mb-10 leading-relaxed">
                  Manage your products, listings, orders and fulfillment from one place.
                </p>
              </Reveal>

              <Reveal delayMs={520}>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-2 bg-white text-black font-medium rounded-full px-6 py-3 text-sm hover:bg-gray-200 transition-colors"
                  >
                    Get Started <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a
                    href="#product"
                    className="inline-flex items-center gap-2 border border-white/15 text-white font-medium rounded-full px-6 py-3 text-sm hover:bg-white/5 transition-colors"
                  >
                    Explore ADKSY
                  </a>
                </div>
              </Reveal>
            </div>

            {/* 3D orb: bubble sphere + central mark + orbiting marketplace/process badges */}
            <div className="hero-fade relative h-[420px] sm:h-[480px] lg:h-[560px]">
              <HeroOrb />
            </div>
          </div>

          {/* Bottom of hero: scroll cue + organic line */}
          <div className="hero-fade relative mt-16 flex flex-col items-center gap-3">
            <span className="text-[11px] uppercase tracking-[0.2em] text-gray-500 landing-pulse">
              Scroll to explore
            </span>
            <span className="w-px h-8 bg-gradient-to-b from-gray-500 to-transparent" aria-hidden="true" />
          </div>
        </HeroStage>

        <svg
          className="absolute bottom-0 left-0 w-full h-24 sm:h-32 text-white/[0.03]"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,60 C300,120 600,0 900,60 C1050,90 1150,40 1200,60 L1200,120 L0,120 Z"
            fill="currentColor"
            className="landing-drift"
          />
        </svg>
      </section>

      {/* ============ ONE PRODUCT. EVERY MARKETPLACE. ============ */}
      <section id="product" className="relative py-28 sm:py-36 px-6 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto text-center">
          <Reveal>
            <h2
              className="font-bold leading-[1.05] mb-6"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
            >
              ONE PRODUCT.
              <br />
              <span className="text-gray-500">EVERY MARKETPLACE.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={120}>
            <p className="text-gray-400 max-w-lg mx-auto mb-16">
              Catalog an item once. Publish it wherever your buyers already are.
            </p>
          </Reveal>
        </div>

        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-3">
          {MARKETPLACES.map((m, i) => (
            <Reveal key={m.name} delayMs={i * 90}>
              <div
                className={`px-5 py-3 rounded-full border text-sm font-medium ${
                  m.status === 'live'
                    ? 'border-white/20 text-white bg-white/[0.04]'
                    : 'border-white/10 text-gray-500 border-dashed'
                }`}
              >
                {m.name}
                {m.status === 'soon' && <span className="ml-2 text-[10px] text-gray-600">soon</span>}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============ HOW ADKSY WORKS ============ */}
      <section id="how-it-works" className="relative py-28 sm:py-36 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#FF5A1F] mb-4 text-center">
              How it works
            </p>
          </Reveal>
          <div className="divide-y divide-white/[0.06]">
            {HOW_IT_WORKS.map((step, i) => (
              <Reveal key={step.n} delayMs={i * 80}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-10 py-8">
                  <span
                    className="font-bold text-gray-700 shrink-0 w-24"
                    style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem' }}
                  >
                    {step.n}
                  </span>
                  <h3 className="font-semibold text-lg text-white sm:w-40 shrink-0">{step.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed max-w-xl">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============ AI / AUTOMATION ============ */}
      <section className="relative py-28 sm:py-36 px-6 bg-[#050506] border-t border-white/[0.06] overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(50% 40% at 50% 40%, rgba(255,90,31,0.05), transparent 70%)' }}
          aria-hidden="true"
        />
        <div className="relative max-w-3xl mx-auto text-center">
          <Reveal>
            <h2
              className="font-bold leading-[1.05] mb-6"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
            >
              YOUR RESELLING
              <br />
              <span className="text-gray-500">AUTOMATION ENGINE.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={120}>
            <p className="text-gray-400 leading-relaxed max-w-xl mx-auto mb-14">
              ADKSY automates the busywork behind every sale — calculating real margin
              on every product, keeping listings and orders in sync across marketplaces,
              and tracking cost, revenue and profit the moment you send an order to
              fulfillment, so you can focus on sourcing.
            </p>
          </Reveal>

          <Reveal delayMs={220}>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {['Margin calculated', 'Listing synced', 'Order matched', 'Fulfillment routed'].map((label, i) => (
                <div
                  key={label}
                  className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-full px-4 py-2"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#FF5A1F] landing-pulse"
                    style={{ animationDelay: `${i * 0.3}s` }}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-gray-300">{label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============ MARKETPLACES ============ */}
      <section id="marketplaces" className="relative py-28 sm:py-36 px-6 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto text-center mb-16">
          <Reveal>
            <h2
              className="font-bold leading-[1.05] mb-6"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
            >
              ONE LISTING.
              <br />
              <span className="text-gray-500">EVERYWHERE.</span>
            </h2>
          </Reveal>
          <Reveal delayMs={120}>
            <p className="text-gray-400 max-w-lg mx-auto">
              eBay is fully automated today. Etsy is live and in review.
              Depop and Vinted are on our roadmap — not yet available.
            </p>
          </Reveal>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {MARKETPLACES.map((m, i) => (
            <Reveal key={m.name} delayMs={i * 90}>
              <div
                className={`rounded-2xl p-6 text-center border ${
                  m.status === 'live' ? 'border-white/15 bg-white/[0.03]' : 'border-white/[0.06] border-dashed'
                }`}
              >
                <p
                  className={`font-bold mb-3 ${m.status === 'live' ? 'text-white' : 'text-gray-600'}`}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {m.name}
                </p>
                <span
                  className={`text-[10px] font-mono uppercase tracking-wide px-2 py-1 rounded-full ${
                    m.status === 'live'
                      ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]'
                      : 'bg-white/5 text-gray-500'
                  }`}
                >
                  {m.badge}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============ FULFILLMENT FLOW ============ */}
      <section className="relative py-28 sm:py-36 px-6 border-t border-white/[0.06] bg-[#050506]">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#FF5A1F] mb-4">
              Fulfillment
            </p>
          </Reveal>
          <Reveal delayMs={100}>
            <h2
              className="font-bold leading-[1.05]"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4.5vw, 3rem)' }}
            >
              One click to fulfillment. Tracked automatically.
            </h2>
          </Reveal>
        </div>

        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-2 flex-wrap">
          {['Customer order', 'ADKSY', 'Fulfillment partner', 'Shipment', 'Tracking'].map((step, i, arr) => (
            <div key={step} className="flex items-center gap-3 sm:gap-2">
              <Reveal delayMs={i * 110}>
                <div className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 whitespace-nowrap">
                  {step}
                </div>
              </Reveal>
              {i < arr.length - 1 && (
                <ArrowRight className="w-4 h-4 text-gray-700 rotate-90 sm:rotate-0 shrink-0" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section id="pricing" className="relative py-28 sm:py-36 px-6 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto text-center mb-16">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#FF5A1F] mb-4">Pricing</p>
          </Reveal>
          <Reveal delayMs={100}>
            <h2
              className="font-bold leading-[1.05]"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4.5vw, 3rem)' }}
            >
              Simple, transparent pricing.
            </h2>
          </Reveal>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delayMs={i * 100}>
              <div
                className={`rounded-2xl p-8 text-center border h-full ${
                  plan.highlighted ? 'border-white/25 bg-white/[0.04]' : 'border-white/10'
                }`}
              >
                <p className="text-sm text-gray-400 mb-4">{plan.name}</p>
                <p className="font-bold text-white mb-1" style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem' }}>
                  &euro;{plan.price}
                </p>
                <p className="text-xs text-gray-600 mb-6">/month, or &euro;{plan.price * 10}/year</p>
                <p className="text-sm text-gray-400">{plan.blurb}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delayMs={300}>
          <div className="text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors border border-white/15 rounded-full px-6 py-3"
            >
              View full pricing
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ============ FEATURES ============ */}
      <section id="features" className="relative py-28 sm:py-36 px-6 border-t border-white/[0.06] bg-[#050506]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <h2
              className="font-bold leading-[1.05] mb-14 max-w-lg"
              style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4.5vw, 3rem)' }}
            >
              Everything between &ldquo;sourced it&rdquo; and &ldquo;shipped it.&rdquo;
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delayMs={i * 90}>
                <div className="border-t border-white/15 pt-5">
                  <f.icon className="w-5 h-5 text-[#FF5A1F] mb-4" />
                  <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="relative py-28 sm:py-40 px-6 border-t border-white/[0.06] text-center">
        <Reveal>
          <h2
            className="font-bold leading-[0.95] mb-10"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.25rem, 7vw, 4.5rem)' }}
          >
            READY TO
            <br />
            <span className="text-gray-500">SELL EVERYWHERE?</span>
          </h2>
        </Reveal>
        <Reveal delayMs={140}>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-white text-black font-medium rounded-full px-8 py-4 text-sm hover:bg-gray-200 transition-colors"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </Reveal>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-white/[0.06] py-10 px-6 text-center text-xs text-gray-600">
        <p>&copy; 2026 ADKSY. All rights reserved.</p>
      </footer>
    </div>
  );
}
