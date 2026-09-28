/**
 * D-4: Enterprise has no Stripe Price ID (see prisma/seed.js) — it is
 * sold via "Contact us", never through Checkout. Extracted as its own
 * pure function (rather than an inline check in subscription/page.tsx) so
 * it can be tested directly without needing to render the connected page
 * component (which needs useWorkspace/fetch mocked to get past its
 * loading state — see that page's own lack of a render test).
 */
export function isEnterprisePlan(plan: { name: string }): boolean {
  return plan.name === 'enterprise';
}
