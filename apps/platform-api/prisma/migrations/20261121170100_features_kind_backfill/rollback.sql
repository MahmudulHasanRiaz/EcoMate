-- Rollback for 20261121170100_features_kind_backfill.
-- Resets the backfilled data only: kind back to INITIAL for the batch,
-- scope/withoutAccess back to NULL, categories back to the old coarse
-- labels (the seed's categoryFor mapping, expressed as a CASE). Text an
-- operator edited after the backfill is lost with it — the same
-- data-loss-only tradeoff as the pricing-engine backfill rollback.
-- (The DDL rollback in 20261121170000 drops the columns anyway.)
UPDATE "Feature" SET "kind" = 'INITIAL' WHERE "key" IN ('storefront', 'storefront_order_tracking', 'storefront_flying_cart', 'storefront_reviews', 'storefront_wishlist', 'storefront_referral', 'offline_conversion', 'integration_ga4', 'integration_tiktok', 'integration_meta', 'integration_google_ads', 'marketing_attribution', 'image_resize_proxy', 's3_storage', 'db_backup', 'pos_system', 'mobile_distribution', 'mobile_distribution_admin', 'mobile_distribution_pos', 'custom_domain', 'smtp_server') AND "kind" = 'ADD_ON';
UPDATE "Feature" SET "scope" = NULL, "withoutAccess" = NULL;
UPDATE "Feature" SET "category" = CASE
  WHEN starts_with("key", 'admin_') THEN 'Admin'
  WHEN starts_with("key", 'storefront') THEN 'Storefront'
  WHEN starts_with("key", 'courier') THEN 'Courier'
  WHEN starts_with("key", 'gateway') THEN 'Payments'
  WHEN starts_with("key", 'marketing') OR starts_with("key", 'integration') THEN 'Marketing'
  WHEN starts_with("key", 'mobile') OR starts_with("key", 'pos') OR "key" IN ('pwa_setup', 'seo_suite', 'offline_conversion', 'image_resize_proxy', 'smtp_server', 's3_storage', 'db_backup', 'custom_domain') THEN 'Platform'
  ELSE 'General'
END;
