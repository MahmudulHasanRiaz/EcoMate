import { FEATURES } from '@ecomate/shared-types';
import {
  ADD_ON_BATCH,
  ADD_ON_SEED_ROWS,
  FEATURE_CONTENT,
} from './feature-content';

describe('feature-content', () => {
  it('covers every catalogue key exactly once (88 features)', () => {
    const catalogueKeys = Object.keys(FEATURES).sort();
    const contentKeys = Object.keys(FEATURE_CONTENT).sort();
    expect(contentKeys).toEqual(catalogueKeys);
    expect(contentKeys).toHaveLength(88);
  });

  it('classifies 67 initial / 21 add-on', () => {
    const kinds = Object.values(FEATURE_CONTENT).map((c) => c.kind);
    expect(kinds.filter((k) => k === 'initial')).toHaveLength(67);
    expect(kinds.filter((k) => k === 'add-on')).toHaveLength(21);
  });

  it('classifies the six backend-gated admin keys as initial (fix #3)', () => {
    for (const key of [
      'admin_cms',
      'admin_checkout_leads',
      'admin_courier',
      'admin_shipments',
      'admin_campaigns',
      'admin_import',
    ]) {
      expect(FEATURE_CONTENT[key].kind).toBe('initial');
      expect(FEATURE_CONTENT[key].scope.trim().length).toBeGreaterThan(10);
      expect(FEATURE_CONTENT[key].withoutAccess.trim().length).toBeGreaterThan(
        10,
      );
    }
    expect(FEATURE_CONTENT.admin_cms.category).toBe('J: Marketing & Content');
    expect(FEATURE_CONTENT.admin_campaigns.category).toBe(
      'J: Marketing & Content',
    );
    expect(FEATURE_CONTENT.admin_checkout_leads.category).toBe(
      'E: Core Admin — Operation',
    );
    expect(FEATURE_CONTENT.admin_courier.category).toBe('L: Courier Services');
    expect(FEATURE_CONTENT.admin_shipments.category).toBe(
      'K: Inventory & Fulfillment',
    );
    expect(FEATURE_CONTENT.admin_import.category).toBe(
      'F: Product Enhancement',
    );
  });

  it('gives every feature a kind, category, scope, and withoutAccess text', () => {
    for (const [key, content] of Object.entries(FEATURE_CONTENT)) {
      expect(['initial', 'add-on']).toContain(content.kind);
      expect(content.category).toMatch(/^[A-O]: /);
      expect(content.scope.trim().length).toBeGreaterThan(10);
      expect(content.withoutAccess.trim().length).toBeGreaterThan(10);
    }
  });

  it('classifies the Boss §0 add-on batch as add-on (21 keys)', () => {
    expect(ADD_ON_BATCH.sort()).toEqual(
      [
        'storefront',
        'storefront_order_tracking',
        'storefront_flying_cart',
        'storefront_reviews',
        'storefront_wishlist',
        'storefront_referral',
        'offline_conversion',
        'integration_ga4',
        'integration_tiktok',
        'integration_meta',
        'integration_google_ads',
        'marketing_attribution',
        'image_resize_proxy',
        's3_storage',
        'db_backup',
        'pos_system',
        'mobile_distribution',
        'mobile_distribution_admin',
        'mobile_distribution_pos',
        'custom_domain',
        'smtp_server',
      ].sort(),
    );
  });

  it('keeps seo_suite, pwa_setup, and admin_email_campaigns initial (Boss §0.5)', () => {
    expect(FEATURE_CONTENT.seo_suite.kind).toBe('initial');
    expect(FEATURE_CONTENT.pwa_setup.kind).toBe('initial');
    expect(FEATURE_CONTENT.admin_email_campaigns.kind).toBe('initial');
  });

  it('seeds the four un-enforced infra add-ons as private, the rest public (fix #5)', () => {
    const bySlug = new Map(ADD_ON_SEED_ROWS.map((row) => [row.slug, row]));
    for (const slug of [
      's3-storage',
      'db-backup',
      'image-resize-proxy',
      'offline-conversion',
    ]) {
      expect(bySlug.get(slug)?.isPublic).toBe(false);
    }
    for (const row of ADD_ON_SEED_ROWS) {
      if (row.isPublic === false) continue;
      expect(row.isPublic ?? true).toBe(true);
    }
    expect(
      ADD_ON_SEED_ROWS.filter((row) => row.isPublic === false),
    ).toHaveLength(4);
  });

  it('seeds one add-on row per batch feature with a positive placeholder price', () => {
    const covered = ADD_ON_SEED_ROWS.flatMap((row) => row.features).sort();
    expect(covered).toEqual([...ADD_ON_BATCH].sort());
    const slugs = new Set<string>();
    for (const row of ADD_ON_SEED_ROWS) {
      expect(row.price).toBeGreaterThan(0);
      expect(row.slug).toMatch(/^[a-z0-9-]+$/);
      expect(slugs.has(row.slug)).toBe(false);
      slugs.add(row.slug);
      // Slug follows the convert-flow derivation (featureKey _ → -).
      expect(row.slug).toBe(row.features[0].replace(/_/g, '-'));
    }
  });
});
