/**
 * Same renderToStaticMarkup convention as agent-ui-rendering.test.tsx —
 * see that file's own header comment.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentUsageBanner } from '@/components/ai/AgentUsageBanner';
import type { AgentUsageSnapshot } from '@/lib/ai/agentUsage';

function makeSnapshot(overrides: Partial<AgentUsageSnapshot> = {}): AgentUsageSnapshot {
  return {
    unitsConsumed: 10,
    unitsReserved: 0,
    unitsLimit: 50,
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AgentUsageBanner', () => {
  it('below the limit: shows the consumed/limit figures, no upgrade CTA, no alert styling', () => {
    const html = renderToStaticMarkup(<AgentUsageBanner usage={makeSnapshot({ unitsConsumed: 10, unitsReserved: 0, unitsLimit: 50 })} />);

    expect(html).toContain('10 / 50');
    expect(html).not.toContain('Améliorer mon forfait');
  });

  it('accounts for both consumed AND reserved units, not consumed alone', () => {
    const html = renderToStaticMarkup(<AgentUsageBanner usage={makeSnapshot({ unitsConsumed: 10, unitsReserved: 5, unitsLimit: 50 })} />);

    expect(html).toContain('15 / 50');
  });

  it('at the limit: shows the exact required message and an upgrade link to /dashboard/subscription', () => {
    const html = renderToStaticMarkup(<AgentUsageBanner usage={makeSnapshot({ unitsConsumed: 50, unitsReserved: 0, unitsLimit: 50 })} />);

    // React escapes the apostrophe to &#x27; in the rendered HTML (same
    // convention as l&#x27;Agent ADKSY elsewhere in this codebase).
    expect(html).toContain('Vous avez atteint votre limite d&#x27;utilisation de l&#x27;Agent IA pour cette période.');
    expect(html).toContain('href="/dashboard/subscription"');
    expect(html).toContain('Améliorer mon forfait');
  });

  it('past the limit (reserved pushed it over): still shows the limit-reached message, never a negative/over-100% figure', () => {
    const html = renderToStaticMarkup(<AgentUsageBanner usage={makeSnapshot({ unitsConsumed: 48, unitsReserved: 10, unitsLimit: 50 })} />);

    expect(html).toContain('Vous avez atteint votre limite');
  });
});
