/**
 * Feature content for the console Features page (Boss point 1, 2026-11-21).
 *
 * Single source of truth for the SEED + MIGRATION BACKFILL defaults:
 * - `kind`: Boss's final classification (spec §0) — 'initial' = in the
 *   base plan, 'add-on' = sold separately. The seed sets it on create;
 *   the operator may change it from the console afterwards (the seed
 *   never overwrites it).
 * - `category`: the A–O catalogue grouping (spec §2). Stored on the
 *   Feature row; the console groups the list by it.
 * - `scope` / `withoutAccess`: EN-ONLY text for the i-button (Boss
 *   decision 7 — Bangla comes with the future multi-lingual system).
 *   Drafted from what each feature actually gates (RequiresFeature
 *   usages in apps/backend, the admin feature-unavailable messages,
 *   and the catalogue). Four catalogue flags have no direct code gate
 *   today (s3_storage, db_backup, image_resize_proxy,
 *   offline_conversion) — their text follows the flag's name and
 *   purpose; it stays editable from the console.
 *
 * The DB row is the source of truth once set; this file only supplies
 * the defaults. The backfill migration
 * (20261121170100_features_kind_backfill) is generated from this file
 * so the two can never disagree.
 */

export type FeatureKindLabel = 'initial' | 'add-on';

export interface FeatureContent {
  kind: FeatureKindLabel;
  /** 'A: Storefront' … 'O: Infrastructure' — sorts alphabetically A–O. */
  category: string;
  /** What the feature covers. */
  scope: string;
  /** What a tenant WITHOUT the feature cannot see or do. */
  withoutAccess: string;
}

const INITIAL: FeatureKindLabel = 'initial';
const ADD_ON: FeatureKindLabel = 'add-on';

export const FEATURE_CONTENT: Record<string, FeatureContent> = {
  // ── A: Storefront (1) ──
  storefront: {
    kind: ADD_ON,
    category: 'A: Storefront',
    scope:
      "The public online store: product pages, cart, checkout, and customer ordering on the tenant's storefront URL.",
    withoutAccess:
      "The public storefront URL shows a 'storefront not enabled' page — visitors cannot browse products or place orders. The admin panel and POS keep working.",
  },

  // ── B: Public Add-ons (5) ──
  storefront_order_tracking: {
    kind: ADD_ON,
    category: 'B: Public Add-ons',
    scope:
      'Public order tracking: customers look up their order status from the storefront without signing in.',
    withoutAccess:
      'Customers cannot track orders from the storefront; order status is only visible to staff in the admin panel.',
  },
  storefront_flying_cart: {
    kind: ADD_ON,
    category: 'B: Public Add-ons',
    scope:
      'The flying-cart drawer: a slide-out mini cart on the storefront so customers review and edit the cart without leaving the page.',
    withoutAccess:
      'No slide-out cart drawer; customers manage the cart only on the cart page.',
  },
  storefront_reviews: {
    kind: ADD_ON,
    category: 'B: Public Add-ons',
    scope:
      'Public product reviews on the storefront: customers submit star ratings and written reviews, staff moderate them from the admin panel.',
    withoutAccess:
      'No review form or review list on product pages; the admin review moderation screens are hidden too.',
  },
  storefront_wishlist: {
    kind: ADD_ON,
    category: 'B: Public Add-ons',
    scope:
      'The customer wishlist: shoppers save products to a personal wishlist on the storefront.',
    withoutAccess:
      'No wishlist button on products and no wishlist page for customers.',
  },
  storefront_referral: {
    kind: ADD_ON,
    category: 'B: Public Add-ons',
    scope:
      'The public referral program: customers share referral links and earn rewards when friends order.',
    withoutAccess:
      'No referral links or rewards on the storefront; the admin referral screens are hidden too.',
  },

  // ── C: Storefront Enhancements (3) ──
  pwa_setup: {
    kind: INITIAL,
    category: 'C: Storefront Enhancements',
    scope:
      'Progressive Web App setup for the storefront: installable app, home-screen icon, and offline shell.',
    withoutAccess:
      'The storefront cannot be installed as an app; it only works as a normal website.',
  },
  seo_suite: {
    kind: INITIAL,
    category: 'C: Storefront Enhancements',
    scope:
      'Storefront SEO: meta titles and descriptions, sitemaps, and search-friendly product URLs.',
    withoutAccess:
      'No SEO controls; product and category pages use default titles and descriptions.',
  },
  offline_conversion: {
    kind: ADD_ON,
    category: 'C: Storefront Enhancements',
    scope:
      'Server-side offline conversion tracking: order events are sent from the server to ad platforms (Meta CAPI and similar) so ads are measured even when browser tracking is blocked.',
    withoutAccess:
      'No server-side conversion events are sent; ad platforms only see browser-side events, so reported conversions can undercount.',
  },

  // ── D: Tracking & Analytics Integrations (4) ──
  integration_ga4: {
    kind: ADD_ON,
    category: 'D: Tracking & Analytics Integrations',
    scope:
      'Google Analytics 4 on the storefront: page views, product views, and purchase events sent to GA4.',
    withoutAccess:
      'No GA4 tracking on the storefront; traffic and sales do not appear in Google Analytics.',
  },
  integration_tiktok: {
    kind: ADD_ON,
    category: 'D: Tracking & Analytics Integrations',
    scope:
      'TikTok Pixel and events on the storefront: page views and purchases sent to TikTok for ad measurement.',
    withoutAccess:
      'No TikTok Pixel on the storefront; TikTok ads cannot measure storefront purchases.',
  },
  integration_meta: {
    kind: ADD_ON,
    category: 'D: Tracking & Analytics Integrations',
    scope:
      'Meta Pixel and Conversions API on the storefront: page views and purchases sent to Meta for ad measurement and optimisation.',
    withoutAccess:
      'No Meta Pixel or Conversions API on the storefront; Meta ads cannot measure storefront purchases.',
  },
  integration_google_ads: {
    kind: ADD_ON,
    category: 'D: Tracking & Analytics Integrations',
    scope:
      'Google Ads conversion tracking on the storefront: purchases reported back to Google Ads.',
    withoutAccess:
      'No Google Ads conversion tracking; purchases are not reported to Google Ads.',
  },

  // ── E: Core Admin — Operation (12) ──
  admin_products: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Product management in the admin panel: create and edit products, variants, prices, and stock.',
    withoutAccess:
      'No product screens in the admin panel; products cannot be created, edited, or stocked.',
  },
  admin_orders: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Order management in the admin panel: view, confirm, dispatch, and cancel orders, and take phone orders.',
    withoutAccess:
      'No order screens in the admin panel; orders cannot be viewed or managed by staff.',
  },
  admin_customers: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Customer management in the admin panel: customer records, order history, and notes.',
    withoutAccess:
      'No customer screens in the admin panel; customer records and history are hidden.',
  },
  admin_brands: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Brand management: brands linked to products and shown on the storefront.',
    withoutAccess:
      'No brand screens; products cannot be grouped or filtered by brand.',
  },
  admin_settings: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Store settings in the admin panel: store profile, checkout, notifications, and general configuration.',
    withoutAccess:
      'No settings screens; store configuration cannot be changed.',
  },
  admin_media: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope: 'The media library: upload and organise product images and files.',
    withoutAccess:
      'No media library; images can only be attached per product, not managed centrally.',
  },
  admin_users: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'User management: staff accounts, roles, and access for the admin panel.',
    withoutAccess:
      'No user management; no new staff accounts can be created and roles cannot be changed.',
  },
  admin_staff_users: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Staff user accounts for the admin panel and POS, separate from the owner account.',
    withoutAccess:
      'No staff accounts can be created; only the owner account can sign in.',
  },
  admin_access_presets: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Access presets: reusable permission bundles assigned to staff roles.',
    withoutAccess:
      'No access presets; permissions must be set per user.',
  },
  admin_print: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Printing in the admin panel: invoices, packing slips, and labels for orders.',
    withoutAccess:
      'No print actions on orders; invoices and packing slips cannot be printed.',
  },
  admin_coupons: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Coupons and discounts: create promo codes and automatic discounts for the storefront and POS.',
    withoutAccess:
      'No coupon screens; discounts cannot be created or applied.',
  },
  admin_checkout_leads: {
    kind: INITIAL,
    category: 'E: Core Admin — Operation',
    scope:
      'Checkout leads: shoppers who started checkout but did not finish — follow them up, assign them to staff, and convert them into orders.',
    withoutAccess:
      'No checkout-lead list; abandoned checkouts cannot be followed up or converted into orders.',
  },

  // ── F: Product Enhancement (6) ──
  admin_size_charts: {
    kind: INITIAL,
    category: 'F: Product Enhancement',
    scope:
      'Size charts on products: measurement tables shoppers consult before buying.',
    withoutAccess:
      'No size charts; products cannot show measurement tables.',
  },
  admin_combos: {
    kind: INITIAL,
    category: 'F: Product Enhancement',
    scope:
      'Combo products: bundles of products sold together at one price.',
    withoutAccess:
      'No combo products; products can only be sold individually.',
  },
  admin_reviews: {
    kind: INITIAL,
    category: 'F: Product Enhancement',
    scope:
      'Review moderation in the admin panel: approve, reject, and reply to storefront product reviews.',
    withoutAccess:
      'No review moderation; submitted reviews cannot be approved or hidden.',
  },
  admin_import_products: {
    kind: INITIAL,
    category: 'F: Product Enhancement',
    scope:
      'Bulk product import: create and update products from a spreadsheet file.',
    withoutAccess:
      'No product import; products can only be created one by one.',
  },
  admin_import: {
    kind: INITIAL,
    category: 'F: Product Enhancement',
    scope:
      'Bulk CSV import: create and update products and orders from spreadsheet files, with import-job status.',
    withoutAccess:
      'No CSV import; products and orders can only be created one by one.',
  },
  admin_price_tags: {
    kind: INITIAL,
    category: 'F: Product Enhancement',
    scope:
      'Price tags and barcodes: print shelf price tags and barcode labels for products.',
    withoutAccess: 'No price-tag or barcode printing.',
  },

  // ── G: Supply Chain (3) ──
  admin_suppliers: {
    kind: INITIAL,
    category: 'G: Supply Chain',
    scope:
      'Supplier management: supplier records linked to purchases and products.',
    withoutAccess:
      'No supplier screens; purchases cannot be linked to a supplier.',
  },
  admin_purchases: {
    kind: INITIAL,
    category: 'G: Supply Chain',
    scope:
      'Purchase orders: record stock bought from suppliers and receive it into inventory.',
    withoutAccess:
      'No purchase orders; incoming stock cannot be recorded against a supplier.',
  },
  admin_order_import: {
    kind: INITIAL,
    category: 'G: Supply Chain',
    scope: 'Bulk order import: create orders from a spreadsheet file.',
    withoutAccess:
      'No order import; orders can only be created one by one.',
  },

  // ── H: Financial (5) ──
  admin_expenses: {
    kind: INITIAL,
    category: 'H: Financial',
    scope:
      'Expense tracking: record business expenses against categories and accounts.',
    withoutAccess: 'No expense screens; expenses cannot be recorded.',
  },
  admin_payments: {
    kind: INITIAL,
    category: 'H: Financial',
    scope:
      'Payment management: record and reconcile customer payments, partial payments, and due amounts.',
    withoutAccess:
      'No payment screens; payments cannot be recorded or reconciled.',
  },
  admin_refunds: {
    kind: INITIAL,
    category: 'H: Financial',
    scope: 'Refund processing: refund orders and record refund payments.',
    withoutAccess: 'No refund actions; refunds cannot be processed.',
  },
  admin_accounting: {
    kind: INITIAL,
    category: 'H: Financial',
    scope:
      'Double-entry accounting: chart of accounts, journal entries, and financial reports.',
    withoutAccess:
      'No accounting screens; journals and financial reports are hidden.',
  },
  admin_financial_periods: {
    kind: INITIAL,
    category: 'H: Financial',
    scope:
      'Financial periods: open and close accounting periods for reporting.',
    withoutAccess:
      'No financial periods; accounting cannot be closed by period.',
  },

  // ── I: HR & Operations (5) ──
  admin_payroll: {
    kind: INITIAL,
    category: 'I: HR & Operations',
    scope: 'Payroll: salary runs and payslips for employees.',
    withoutAccess: 'No payroll screens; salaries cannot be processed.',
  },
  admin_employees: {
    kind: INITIAL,
    category: 'I: HR & Operations',
    scope:
      'Employee records: staff profiles, attendance inputs, and employment details.',
    withoutAccess:
      'No employee records; staff profiles cannot be managed.',
  },
  admin_tasks: {
    kind: INITIAL,
    category: 'I: HR & Operations',
    scope: 'Task management: assign and track internal tasks for staff.',
    withoutAccess: 'No task screens; tasks cannot be created or assigned.',
  },
  admin_hr: {
    kind: INITIAL,
    category: 'I: HR & Operations',
    scope: 'HR panel: leave, attendance, and HR records for the team.',
    withoutAccess:
      'No HR screens; leave and attendance cannot be managed.',
  },
  admin_hr_careers: {
    kind: INITIAL,
    category: 'I: HR & Operations',
    scope:
      'Careers management in the HR panel: job postings and job applications. The public careers page itself stays visible.',
    withoutAccess:
      'No job-posting or application management in the HR panel; the public careers page stays up but shows no openings.',
  },

  // ── J: Marketing & Content (8) ──
  admin_email_campaigns: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      "Email campaigns: compose and send marketing emails to customers. Sending uses the SMTP add-on's email balance.",
    withoutAccess:
      'No email campaign screens; marketing emails cannot be composed or sent.',
  },
  admin_campaigns: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      'Email campaigns: message templates, scheduled campaigns, and sending to recipient lists through the email queue.',
    withoutAccess:
      'No campaign screens; email campaigns and templates cannot be created, scheduled, or sent.',
  },
  admin_landing_pages: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      'Landing page builder: promotional pages with custom sections on the storefront.',
    withoutAccess:
      'No landing page builder; promotional pages cannot be created.',
  },
  admin_cms_pages: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      'CMS pages: informational pages (about, policies, custom content) on the storefront.',
    withoutAccess:
      'No CMS page builder; informational pages cannot be created or edited.',
  },
  admin_cms: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      'Content management: CMS pages (about, policies, custom content) and the store-location list shown on the storefront.',
    withoutAccess:
      'No CMS page or store-location screens; informational pages and store locations cannot be created or edited.',
  },
  admin_product_feeds: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      'Product feeds: generate catalogue feeds for Meta, Google, and other shopping channels.',
    withoutAccess:
      'No product feeds; catalogues cannot be exported to shopping channels.',
  },
  admin_referrals: {
    kind: INITIAL,
    category: 'J: Marketing & Content',
    scope:
      'Referral management in the admin panel: track referred customers and referral rewards.',
    withoutAccess:
      'No referral management; referred customers and rewards cannot be tracked.',
  },
  marketing_attribution: {
    kind: ADD_ON,
    category: 'J: Marketing & Content',
    scope:
      'Marketing attribution: ad accounts, ad spend, funding, and revenue attribution across Meta, TikTok, and Google.',
    withoutAccess:
      'No attribution dashboard, ad accounts, or funding tracking; ad spend and return cannot be measured.',
  },

  // ── K: Inventory & Fulfillment (10) ──
  admin_inventory: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Inventory management: stock levels, adjustments, and stock history per product and variant.',
    withoutAccess:
      'No inventory screens; stock levels cannot be viewed or adjusted.',
  },
  admin_warehouses: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Warehouses: multiple stock locations with per-warehouse stock levels and transfers.',
    withoutAccess:
      'No warehouses; all stock lives in one default location.',
  },
  admin_inventory_valuation: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Inventory valuation: stock value reports by cost and selling price.',
    withoutAccess:
      'No valuation reports; stock value cannot be measured.',
  },
  admin_dispatch: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Dispatch: assign orders to couriers and print courier labels.',
    withoutAccess:
      'No dispatch screens; orders cannot be assigned to couriers from the panel.',
  },
  admin_packing: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'The packing workspace: pick, verify, and pack orders with photo checks.',
    withoutAccess:
      'No packing workspace; orders cannot move through the pack-and-verify flow.',
  },
  admin_barcode_search: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Barcode search: find products by scanning a barcode in the admin panel and POS.',
    withoutAccess:
      'No barcode search; products can only be found by typing a name or SKU.',
  },
  admin_incomplete_orders: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Incomplete order tracking: orders started but never finished, for follow-up.',
    withoutAccess:
      'No incomplete-order list; abandoned checkouts cannot be followed up.',
  },
  admin_global_search: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Global search in the admin panel: search products, orders, and customers from one box.',
    withoutAccess:
      'No global search; each screen must be searched separately.',
  },
  admin_tracking: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Tracking pipeline admin: order-source policies, event monitoring, and tracking-data cleanup.',
    withoutAccess:
      'No tracking admin; order-source policies and event monitoring are hidden.',
  },
  admin_shipments: {
    kind: INITIAL,
    category: 'K: Inventory & Fulfillment',
    scope:
      'Shipments and shipping setup: per-order shipment records plus shipping options and delivery zones.',
    withoutAccess:
      'No shipment records and no shipping setup; delivery options and zones cannot be configured.',
  },

  // ── L: Courier Services (6) ──
  courier_steadfast: {
    kind: INITIAL,
    category: 'L: Courier Services',
    scope:
      'SteadFast courier: create consignments, print labels, and sync delivery status.',
    withoutAccess:
      'No SteadFast option at dispatch; SteadFast consignments cannot be created or tracked.',
  },
  courier_pathao: {
    kind: INITIAL,
    category: 'L: Courier Services',
    scope:
      'Pathao courier: create consignments, print labels, and sync delivery status.',
    withoutAccess:
      'No Pathao option at dispatch; Pathao consignments cannot be created or tracked.',
  },
  courier_redx: {
    kind: INITIAL,
    category: 'L: Courier Services',
    scope:
      'RedX courier: create consignments, print labels, and sync delivery status.',
    withoutAccess:
      'No RedX option at dispatch; RedX consignments cannot be created or tracked.',
  },
  courier_carrybee: {
    kind: INITIAL,
    category: 'L: Courier Services',
    scope:
      'Carrybee courier: create consignments, print labels, and sync delivery status.',
    withoutAccess:
      'No Carrybee option at dispatch; Carrybee consignments cannot be created or tracked.',
  },
  admin_courier_settlement: {
    kind: INITIAL,
    category: 'L: Courier Services',
    scope:
      'Courier settlement: import courier invoices, reconcile COD and delivery charges, and settle claims.',
    withoutAccess:
      'No settlement screens; courier invoices cannot be imported or reconciled.',
  },
  admin_courier: {
    kind: INITIAL,
    category: 'L: Courier Services',
    scope:
      'Courier management: courier accounts and credentials, consignment tracking, delivery webhooks, and the customer-history lookup.',
    withoutAccess:
      'No courier settings or tracking; courier accounts cannot be connected and delivery status cannot be checked.',
  },

  // ── M: Payment Gateways (6) ──
  gateway_bkash: {
    kind: INITIAL,
    category: 'M: Payment Gateways',
    scope: 'bKash payment gateway on the storefront checkout.',
    withoutAccess:
      'bKash is not offered at checkout; customers cannot pay with bKash.',
  },
  gateway_nagad: {
    kind: INITIAL,
    category: 'M: Payment Gateways',
    scope: 'Nagad payment gateway on the storefront checkout.',
    withoutAccess:
      'Nagad is not offered at checkout; customers cannot pay with Nagad.',
  },
  gateway_rocket: {
    kind: INITIAL,
    category: 'M: Payment Gateways',
    scope: 'Rocket payment gateway on the storefront checkout.',
    withoutAccess:
      'Rocket is not offered at checkout; customers cannot pay with Rocket.',
  },
  gateway_sslcommerz: {
    kind: INITIAL,
    category: 'M: Payment Gateways',
    scope:
      'SSLCommerz payment gateway on the storefront checkout (cards and mobile banking).',
    withoutAccess:
      'SSLCommerz is not offered at checkout; customers cannot pay by card or mobile banking through it.',
  },
  gateway_surjopay: {
    kind: INITIAL,
    category: 'M: Payment Gateways',
    scope: 'SurjoPay payment gateway on the storefront checkout.',
    withoutAccess:
      'SurjoPay is not offered at checkout; customers cannot pay through SurjoPay.',
  },
  gateway_aamarpay: {
    kind: INITIAL,
    category: 'M: Payment Gateways',
    scope: 'AamarPay payment gateway on the storefront checkout.',
    withoutAccess:
      'AamarPay is not offered at checkout; customers cannot pay through AamarPay.',
  },

  // ── N: Admin Tools (5) ──
  admin_notifications: {
    kind: INITIAL,
    category: 'N: Admin Tools',
    scope:
      'Notification configuration: order and system alerts for staff and customers.',
    withoutAccess:
      'No notification settings; alerts cannot be configured.',
  },
  admin_blocking: {
    kind: INITIAL,
    category: 'N: Admin Tools',
    scope:
      'IP and phone blocking: block abusive phones and IPs from storefront ordering.',
    withoutAccess:
      'No blocking screens; abusive phones and IPs cannot be blocked.',
  },
  admin_analytics: {
    kind: INITIAL,
    category: 'N: Admin Tools',
    scope:
      'Advanced analytics: sales, product, and customer reports beyond the dashboard.',
    withoutAccess:
      'No analytics screens; only the basic dashboard is available.',
  },
  admin_activity_logs: {
    kind: INITIAL,
    category: 'N: Admin Tools',
    scope:
      'Activity logs: who changed what in the admin panel, with a searchable history.',
    withoutAccess: 'No activity logs; staff actions cannot be audited.',
  },
  admin_help_center: {
    kind: INITIAL,
    category: 'N: Admin Tools',
    scope:
      'Help center management: help articles shown to staff inside the admin panel.',
    withoutAccess:
      'No help center management; help articles cannot be created or edited.',
  },

  // ── O: Infrastructure (9) ──
  mobile_distribution: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      "Mobile app distribution: build and distribute the store's mobile app to customers.",
    withoutAccess:
      'No mobile app builds; customers can only shop on the website.',
  },
  mobile_distribution_admin: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope: 'Mobile admin app distribution: the staff admin app for phones.',
    withoutAccess:
      'No mobile admin app; staff can only use the admin panel on the web.',
  },
  mobile_distribution_pos: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      'Mobile POS app distribution: the point-of-sale app for phones and tablets.',
    withoutAccess:
      'No mobile POS app; POS can only run on the web.',
  },
  image_resize_proxy: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      'Image resize proxy: product images are served in resized variants matched to each screen, so pages load faster.',
    withoutAccess:
      'Images are served at full original size; no resized variants are generated.',
  },
  pos_system: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      'The point-of-sale system: in-store checkout, cash drawers, and POS sessions.',
    withoutAccess:
      'No POS; in-store sales cannot be rung up and no POS sessions can be opened.',
  },
  smtp_server: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      "Email sending: the tenant's own SMTP settings (BYO) or EcoMate's shared SMTP billed from a prepaid email balance. Gates all SMTP UI — balance, settings, and top-up.",
    withoutAccess:
      'No email balance, no SMTP settings, and no top-up anywhere in the admin panel; no order or customer emails can be sent.',
  },
  s3_storage: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      "S3-compatible object storage for media and uploads, instead of the server's local disk.",
    withoutAccess:
      "Uploads stay on the server's local disk; no S3 bucket is provisioned.",
  },
  db_backup: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope: "Scheduled database backups for the tenant's store data.",
    withoutAccess:
      'No scheduled backups; the store cannot be restored from a backup.',
  },
  custom_domain: {
    kind: ADD_ON,
    category: 'O: Infrastructure',
    scope:
      "Custom domains: connect the storefront to the tenant's own domain name with automatic TLS.",
    withoutAccess:
      'No custom domain; the storefront only answers on its EcoMate subdomain.',
  },

  // ── P: External Stores (5) ──
  // Central commerce (Phase 9, multi-tenant first). All five are
  // add-ons, sold together as the single `external-stores` add-on
  // (ruling D2, Option A) — but each key stays individually addressable
  // in the catalogue (pricing-v2 three-catalogue direction), so
  // per-provider / per-feature splits stay expressible later through
  // console add-on configuration alone, with no code change.
  admin_stores: {
    kind: ADD_ON,
    category: 'P: External Stores',
    scope:
      'External stores: connect WooCommerce, Shopify, or custom-bridge stores to EcoMate and manage them from Sales Channels — connection, health, and per-store settings.',
    withoutAccess:
      'No Sales Channels section; no external store can be connected, so products, orders, and stock live only in EcoMate.',
  },
  store_product_sync: {
    kind: ADD_ON,
    category: 'P: External Stores',
    scope:
      'Product sync: publish EcoMate products, variants, categories, and media to connected external stores, and keep field ownership and overrides in sync.',
    withoutAccess:
      'Products cannot be published or synced to external stores; the store catalogue must be maintained separately on each channel.',
  },
  store_order_sync: {
    kind: ADD_ON,
    category: 'P: External Stores',
    scope:
      'Order sync: pull orders placed on connected external stores into EcoMate, and push EcoMate order status (cancelled, delivered) back to the channel.',
    withoutAccess:
      'Orders from external stores are not pulled in and EcoMate order status is not pushed back; each channel must be fulfilled separately.',
  },
  store_stock_sync: {
    kind: ADD_ON,
    category: 'P: External Stores',
    scope:
      'Stock sync: keep stock levels on connected external stores in step with EcoMate inventory — real quantities in the 1–5 band, capped or status-only above it.',
    withoutAccess:
      'Stock on external stores is never updated from EcoMate; quantities shown on each channel drift from real inventory.',
  },
  admin_sync_center: {
    kind: ADD_ON,
    category: 'P: External Stores',
    scope:
      'Sync Center: run history, per-item results, sync issues, retries, and retention for every external-store sync job.',
    withoutAccess:
      'No Sync Center; sync runs, failures, and issues cannot be inspected or retried from the admin panel.',
  },
};

/** Feature keys classified as add-ons by default (Boss §0). */
export const ADD_ON_BATCH: string[] = Object.entries(FEATURE_CONTENT)
  .filter(([, content]) => content.kind === 'add-on')
  .map(([key]) => key);

/**
 * Placeholder add-on rows seeded for the add-on batch — one add-on per
 * feature (Boss: prices are Muse's choice for now, all configurable
 * from the console), EXCEPT `external-stores`, which bundles the five
 * External Stores keys into one add-on (Phase 9 ruling D2, Option A).
 * Slugs follow the convert-flow derivation (featureKey with '_' → '-'),
 * so a later conversion of an already-seeded feature finds its add-on
 * instead of duplicating it — the bundled row is the one exception.
 * All MONTHLY / BDT; public unless isPublic is false.
 *
 * isPublic: false marks the four infra add-ons whose features have NO
 * code gate yet (s3_storage, db_backup, image_resize_proxy,
 * offline_conversion — a repo-wide grep finds zero RequiresFeature /
 * hasFeature checks for them). They stay private / console-only until
 * enforcement is wired — selling an add-on nothing enforces would
 * charge tenants for nothing. Flip to public when the gates land.
 * `external-stores` is likewise private until the Phase 9 isolation
 * gate passes (port plan §3.12.2). Trial attach ignores isPublic, so
 * trial tenants still get them — except external-stores, which trial
 * never attaches (ruling D3).
 */
export interface AddOnSeedRow {
  slug: string;
  name: string;
  description: string;
  /** Placeholder monthly price in BDT. */
  price: number;
  features: string[];
  /** Plan-limit grants, merged max-wins with the plan (e.g. { external_stores: 3 }). */
  limits?: Record<string, number>;
  sortOrder: number;
  /** Default true. False = private, console-only (see the note above). */
  isPublic?: boolean;
}

export const ADD_ON_SEED_ROWS: AddOnSeedRow[] = [
  {
    slug: 'storefront',
    name: 'Storefront',
    description:
      "The public online store: product pages, cart, and checkout on the tenant's storefront URL.",
    price: 499,
    features: ['storefront'],
    sortOrder: 10,
  },
  {
    slug: 'pos-system',
    name: 'POS System',
    description:
      'In-store point of sale: checkout, cash drawers, and POS sessions.',
    price: 399,
    features: ['pos_system'],
    sortOrder: 20,
  },
  {
    slug: 'smtp-server',
    name: 'SMTP & Email Sending',
    description:
      'Email sending for the store: own SMTP settings or EcoMate shared SMTP billed from a prepaid email balance.',
    price: 199,
    features: ['smtp_server'],
    sortOrder: 30,
  },
  {
    slug: 'custom-domain',
    name: 'Custom Domain',
    description:
      "Connect the storefront to the store's own domain name, with automatic TLS.",
    price: 149,
    features: ['custom_domain'],
    sortOrder: 40,
  },
  {
    slug: 'integration-meta',
    name: 'Meta Pixel & CAPI',
    description: 'Meta Pixel and Conversions API tracking on the storefront.',
    price: 299,
    features: ['integration_meta'],
    sortOrder: 50,
  },
  {
    slug: 'integration-tiktok',
    name: 'TikTok Pixel',
    description: 'TikTok Pixel and event tracking on the storefront.',
    price: 299,
    features: ['integration_tiktok'],
    sortOrder: 51,
  },
  {
    slug: 'integration-google-ads',
    name: 'Google Ads Tracking',
    description: 'Google Ads conversion tracking on the storefront.',
    price: 299,
    features: ['integration_google_ads'],
    sortOrder: 52,
  },
  {
    slug: 'integration-ga4',
    name: 'Google Analytics 4',
    description: 'Google Analytics 4 tracking on the storefront.',
    price: 149,
    features: ['integration_ga4'],
    sortOrder: 53,
  },
  {
    slug: 'offline-conversion',
    name: 'Offline Conversion Tracking',
    description: 'Server-side conversion events sent to ad platforms.',
    price: 299,
    features: ['offline_conversion'],
    sortOrder: 54,
    // Not enforced in code yet — private until the gate is wired.
    isPublic: false,
  },
  {
    slug: 'marketing-attribution',
    name: 'Marketing Attribution',
    description:
      'Ad spend, funding, and revenue attribution across ad platforms.',
    price: 399,
    features: ['marketing_attribution'],
    sortOrder: 55,
  },
  {
    slug: 'storefront-order-tracking',
    name: 'Public Order Tracking',
    description: 'Let customers track their order status from the storefront.',
    price: 99,
    features: ['storefront_order_tracking'],
    sortOrder: 60,
  },
  {
    slug: 'storefront-flying-cart',
    name: 'Flying Cart',
    description: 'Slide-out mini cart on the storefront.',
    price: 99,
    features: ['storefront_flying_cart'],
    sortOrder: 61,
  },
  {
    slug: 'storefront-reviews',
    name: 'Product Reviews',
    description: 'Public product reviews with staff moderation.',
    price: 99,
    features: ['storefront_reviews'],
    sortOrder: 62,
  },
  {
    slug: 'storefront-wishlist',
    name: 'Wishlist',
    description: 'Customer wishlists on the storefront.',
    price: 99,
    features: ['storefront_wishlist'],
    sortOrder: 63,
  },
  {
    slug: 'storefront-referral',
    name: 'Referral Program',
    description: 'Customer referral links and rewards.',
    price: 149,
    features: ['storefront_referral'],
    sortOrder: 64,
  },
  {
    slug: 'image-resize-proxy',
    name: 'Image Resize Proxy',
    description: 'On-the-fly resized image variants for faster pages.',
    price: 99,
    features: ['image_resize_proxy'],
    sortOrder: 70,
    // Not enforced in code yet — private until the gate is wired.
    isPublic: false,
  },
  {
    slug: 's3-storage',
    name: 'S3 Media Storage',
    description: 'Media and uploads on S3-compatible object storage.',
    price: 199,
    features: ['s3_storage'],
    sortOrder: 71,
    // Not enforced in code yet — private until the gate is wired.
    isPublic: false,
  },
  {
    slug: 'db-backup',
    name: 'Database Backups',
    description: "Scheduled backups of the store's database.",
    price: 199,
    features: ['db_backup'],
    sortOrder: 72,
    // Not enforced in code yet — private until the gate is wired.
    isPublic: false,
  },
  {
    slug: 'mobile-distribution',
    name: 'Mobile App',
    description: "Build and distribute the store's customer mobile app.",
    price: 499,
    features: ['mobile_distribution'],
    sortOrder: 80,
  },
  {
    slug: 'mobile-distribution-admin',
    name: 'Mobile Admin App',
    description: 'The staff admin app for phones.',
    price: 199,
    features: ['mobile_distribution_admin'],
    sortOrder: 81,
  },
  {
    slug: 'mobile-distribution-pos',
    name: 'Mobile POS App',
    description: 'The point-of-sale app for phones and tablets.',
    price: 199,
    features: ['mobile_distribution_pos'],
    sortOrder: 82,
  },
  {
    slug: 'external-stores',
    name: 'External Stores',
    description:
      'Connect WooCommerce, Shopify, or custom-bridge stores and sync products, orders, and stock with EcoMate.',
    price: 499,
    features: [
      'admin_stores',
      'store_product_sync',
      'store_order_sync',
      'store_stock_sync',
      'admin_sync_center',
    ],
    // Ruling D4: the add-on grants 3 connected external stores.
    limits: { external_stores: 3 },
    sortOrder: 90,
    // Private until the Phase 9 two-tenant isolation gate passes
    // (port plan §3.12.2) — the keys must not be sold before then.
    // Trial never attaches this add-on (ruling D3).
    isPublic: false,
  },
];
