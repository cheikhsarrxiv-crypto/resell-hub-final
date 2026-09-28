import { describe, it, expect } from 'vitest';
import { isEnterprisePlan } from '@/lib/subscription/planHelpers';

describe('isEnterprisePlan', () => {
  it('true for the enterprise plan', () => {
    expect(isEnterprisePlan({ name: 'enterprise' })).toBe(true);
  });

  it('false for every other real plan', () => {
    for (const name of ['free', 'starter', 'pro', 'business']) {
      expect(isEnterprisePlan({ name })).toBe(false);
    }
  });

  it('case-sensitive — never matches "Enterprise" (a displayName-shaped value) by accident', () => {
    expect(isEnterprisePlan({ name: 'Enterprise' })).toBe(false);
  });
});
