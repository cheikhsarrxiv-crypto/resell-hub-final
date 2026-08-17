import { Button } from '@/components/UI/Button';
import Link from 'next/link';
import { Check } from 'lucide-react';

const plans = [
  {
    name: 'Free',
    price: 0,
    description: 'Perfect for getting started',
    features: [
      'Up to 10 products',
      'Up to 20 listings',
      'Up to 50 orders / month',
      '2 marketplace connections',
      'Manual fulfillment only',
    ],
    cta: 'Get Started',
  },
  {
    name: 'Starter',
    price: 19,
    description: 'For small resellers',
    features: [
      'Up to 100 products',
      'Up to 300 listings',
      'Up to 500 orders / month',
      '3 marketplace connections',
      'Manual fulfillment',
    ],
    cta: 'Try Free',
    popular: true,
  },
  {
    name: 'Pro',
    price: 49,
    description: 'For growing businesses',
    features: [
      'Up to 500 products',
      'Up to 1,500 listings',
      'Up to 2,000 orders / month',
      '4 marketplace connections',
      'Advanced analytics',
      'Automated fulfillment',
    ],
    cta: 'Try Free',
  },
  {
    name: 'Business',
    price: 99,
    description: 'For large operations',
    features: [
      'Up to 5,000 products',
      'Up to 10,000 listings',
      'Up to 10,000 orders / month',
      '4 marketplace connections',
      'Up to 5 team members',
      'Advanced analytics',
      'Automated fulfillment',
      'API access',
    ],
    cta: 'Try Free',
  },
  {
    name: 'Enterprise',
    price: null,
    description: 'Custom solution for high-volume sellers',
    features: [
      'Unlimited products & listings',
      'Unlimited orders',
      '4 marketplace connections',
      'Unlimited team members',
      'Advanced analytics',
      'Automated fulfillment',
      'API access',
      'Dedicated support',
    ],
    cta: 'Contact Us',
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      {/* Navigation */}
      <nav className="flex justify-between items-center px-6 py-5 max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
            <path d="M24 48 L36 22 L48 48 M29 39 H43" stroke="#14161A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <span className="font-display text-xl font-bold text-[#14161A] tracking-tight">ADKSY</span>
        </Link>
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

      {/* Header */}
      <section className="max-w-6xl mx-auto px-6 py-16 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-[#FF5A1F] mb-3">Pricing</p>
        <h1 className="font-display text-4xl font-bold text-[#14161A] mb-4">Simple, transparent pricing</h1>
        <p className="text-lg text-gray-600 mb-4 max-w-xl mx-auto">
          Choose the plan that fits your reselling business. Upgrade or downgrade anytime.
        </p>
      </section>

      {/* Pricing Cards */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-lg shadow-lg overflow-hidden transition-all ${
                plan.popular
                  ? 'ring-2 ring-blue-600 md:scale-105 shadow-2xl'
                  : 'bg-white'
              }`}
            >
              {plan.popular && (
                <div className="bg-blue-600 text-white px-4 py-2 text-center text-sm font-semibold">
                  Most Popular
                </div>
              )}

              <div className={`p-8 ${plan.popular ? 'bg-white' : ''}`}>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <p className="text-gray-600 text-sm mb-4">{plan.description}</p>

                <div className="mb-6">
                  {plan.price === null ? (
                    <span className="text-4xl font-bold text-gray-900">Custom</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold text-gray-900">
                        {plan.price.toFixed(0)}€
                      </span>
                      <span className="text-gray-600 ml-2">/month</span>
                      {plan.price > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          or {(plan.price * 10).toFixed(0)}€/year (2 months free)
                        </p>
                      )}
                    </>
                  )}
                </div>

                <Link href={plan.price === null ? 'mailto:sales@resellhub.io' : '/signup'}>
                  <Button
                    variant={plan.popular ? 'primary' : 'outline'}
                    className="w-full mb-6"
                  >
                    {plan.cta}
                  </Button>
                </Link>

                <div className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <span className="text-gray-700 text-sm">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="font-display text-3xl font-bold text-[#14161A] mb-12 text-center">
          Frequently asked questions
        </h2>

        <div className="space-y-8">
          {[
            {
              q: 'Can I change my plan anytime?',
              a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.',
            },
            {
              q: 'How does cancellation work?',
              a: 'You can cancel your subscription anytime from your account settings — no phone calls, no forms.',
            },
            {
              q: 'What payment methods do you accept?',
              a: 'We accept all major credit and debit cards via Stripe.',
            },
            {
              q: 'Is there a free trial?',
              a: 'Yes! Start with our Free plan and upgrade anytime to access more features.',
            },
          ].map((faq, idx) => (
            <div key={idx}>
              <h3 className="font-semibold text-[#14161A] mb-2">{faq.q}</h3>
              <p className="text-gray-600">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#E5E2DB] py-10 text-center text-sm text-gray-500">
        <p>&copy; 2026 ADKSY. All rights reserved.</p>
      </footer>
    </div>
  );
}
