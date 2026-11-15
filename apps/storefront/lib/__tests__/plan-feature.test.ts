import { describe, it, expect } from 'vitest';
import { hasPlanFeature } from '@/lib/api/storefront-config';

describe('hasPlanFeature (plan wildcard)', () => {
  it("opens every feature for the '*' plan", () => {
    expect(hasPlanFeature({ planFeatures: ['*'] }, 'admin_combos')).toBe(true);
    expect(hasPlanFeature({ planFeatures: ['*'] }, 'storefront_wishlist')).toBe(true);
    expect(hasPlanFeature({ planFeatures: ['*'] }, 'anything_at_all')).toBe(true);
  });

  it('matches exact features without wildcard', () => {
    const config = { planFeatures: ['admin_combos'] };
    expect(hasPlanFeature(config, 'admin_combos')).toBe(true);
    expect(hasPlanFeature(config, 'storefront_wishlist')).toBe(false);
  });

  it('denies safely on missing config', () => {
    expect(hasPlanFeature(null, 'admin_combos')).toBe(false);
    expect(hasPlanFeature(undefined, 'admin_combos')).toBe(false);
    expect(hasPlanFeature({}, 'admin_combos')).toBe(false);
  });
});
