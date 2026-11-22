import { FEATURES } from '@ecomate/shared-types';
import {
  ADD_ON_BATCH,
  ADD_ON_SEED_ROWS,
  FEATURE_CONTENT,
} from './feature-content';

describe('feature-content', () => {
  it('covers every catalogue key exactly once (93 features)', () => {
    const catalogueKeys = Object.keys(FEATURES).sort();
    const contentKeys = Object.keys(FEATURE_CONTENT).sort();
    expect(contentKeys).toEqual(catalogueKeys);
    expect(contentKeys).toHaveLength(93);
  });

  it('classifies 67 initial / 26 add-on', () => {
    const kinds = Object.values(FEATURE_CONTENT).map((c) => c.kind);
    expect(kinds.filter((k) => k === 'initial')).toHaveLength(67);
    expect(kinds.filter((k) => k === 'add-on')).toHaveLength(26);
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
      expect(content.category).toMatch(/^[A-P]: /);
      expect(content.scope.trim().length).toBeGreaterThan(10);
      expect(content.withoutAccess.trim().length).toBeGreaterThan(10);
    }
  });

  it('classifies the Boss §0 add-on batch as add-on (21 keys) + the 5 External Stores keys', () => {
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
        // Phase 9 (ruling D2): the five External Stores keys, sold as
        // the single `external-stores` add-on.
        'admin_stores',
        'store_product_sync',
        'store_order_sync',
        'store_stock_sync',
        'admin_sync_center',
      ].sort(),
    );
  });

  it('keeps seo_suite, pwa_setup, and admin_email_campaigns initial (Boss §0.5)', () => {
    expect(FEATURE_CONTENT.seo_suite.kind).toBe('initial');
    expect(FEATURE_CONTENT.pwa_setup.kind).toBe('initial');
    expect(FEATURE_CONTENT.admin_email_campaigns.kind).toBe('initial');
  });

  it('classifies the five External Stores keys as add-ons in category P (Phase 9)', () => {
    for (const key of [
      'admin_stores',
      'store_product_sync',
      'store_order_sync',
      'store_stock_sync',
      'admin_sync_center',
    ]) {
      expect(FEATURE_CONTENT[key].kind).toBe('add-on');
      expect(FEATURE_CONTENT[key].category).toBe('P: External Stores');
      expect(FEATURE_CONTENT[key].scope.trim().length).toBeGreaterThan(10);
      expect(FEATURE_CONTENT[key].withoutAccess.trim().length).toBeGreaterThan(
        10,
      );
    }
  });

  it('seeds the external-stores add-on as one private row granting all five keys + the 3-store limit (Phase 9 ruling D2/D4)', () => {
    const row = ADD_ON_SEED_ROWS.find((r) => r.slug === 'external-stores');
    expect(row).toBeDefined();
    expect(row?.price).toBe(499);
    expect(row?.features).toEqual([
      'admin_stores',
      'store_product_sync',
      'store_order_sync',
      'store_stock_sync',
      'admin_sync_center',
    ]);
    expect(row?.limits).toEqual({ external_stores: 3 });
    expect(row?.isPublic).toBe(false);
  });

  it('seeds the four un-enforced infra add-ons + external-stores as private, the rest public (fix #5)', () => {
    const bySlug = new Map(ADD_ON_SEED_ROWS.map((row) => [row.slug, row]));
    for (const slug of [
      's3-storage',
      'db-backup',
      'image-resize-proxy',
      'offline-conversion',
      'external-stores',
    ]) {
      expect(bySlug.get(slug)?.isPublic).toBe(false);
    }
    for (const row of ADD_ON_SEED_ROWS) {
      if (row.isPublic === false) continue;
      expect(row.isPublic ?? true).toBe(true);
    }
    expect(
      ADD_ON_SEED_ROWS.filter((row) => row.isPublic === false),
    ).toHaveLength(5);
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
      // Slug follows the convert-flow derivation (featureKey _ → -) for
      // single-feature rows. The bundled `external-stores` row is the
      // one documented exception (Phase 9 ruling D2, Option A).
      if (row.features.length === 1) {
        expect(row.slug).toBe(row.features[0].replace(/_/g, '-'));
      }
    }
  });
});
