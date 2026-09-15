/**
 * Priority 3 fix: the onboarding marketplace step used to present eBay,
 * Etsy, Vinted, and Depop as four equivalent checkboxes, even though only
 * eBay/Etsy have a working OAuth connection (SUPPORTED_MARKETPLACES in
 * the connect route) — a new user could pick Vinted/Depop and hit a dead
 * end later with no explanation.
 *
 * Fixed by splitting the list into `availableMarketplaces` (selectable)
 * and `comingSoonMarketplaces` (shown, but never selectable) — exported
 * from the component module so this can be verified without a rendering
 * library (none is set up in this project).
 */
import { describe, it, expect } from 'vitest'
import { availableMarketplaces, comingSoonMarketplaces } from '@/app/onboarding/steps/marketplaceAvailability'

describe('Onboarding marketplace list — only real connections are offered as available', () => {
  it('lists exactly eBay and Etsy as available', () => {
    const ids = availableMarketplaces.map((m) => m.id).sort()
    expect(ids).toEqual(['ebay', 'etsy'])
  })

  it('lists Vinted, Depop, and Vestiaire Collective as waiting on partner access, not as available', () => {
    const ids = comingSoonMarketplaces.map((m) => m.id).sort()
    expect(ids).toEqual(['depop', 'vestiaire-collective', 'vinted'])
  })

  it('no marketplace appears in both lists at once', () => {
    const availableIds = new Set(availableMarketplaces.map((m) => m.id))
    const overlap = comingSoonMarketplaces.filter((m) => availableIds.has(m.id))
    expect(overlap).toEqual([])
  })
})
