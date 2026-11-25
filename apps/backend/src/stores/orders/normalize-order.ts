/**
 * Order normalization — central-commerce P6 (§8.5 ingest worker step 2).
 *
 * Pure functions: provider payloads (WooCommerce REST, Shopify REST, Custom
 * bridge v1, FakeProvider fixtures) → one canonical `NormalizedIngestOrder`.
 * Unit-tested in isolation; the worker never parses provider JSON itself.
 *
 * Sanitization: only allowlisted scalar fields are extracted. Unknown keys,
 * credentials and secrets structurally cannot flow into the order pipeline
 * (the `sanitizeFailurePayload` pattern, §4.1).
 */
import { createHash } from 'crypto';
import {
  resolveDistrictFromWooStateCode,
  resolveDivision,
} from '../../delivery-areas/data/district-division';

export interface NormalizedIngestItem {
  sku: string;
  name: string;
  quantity: number;
  /** Unit price in store currency (number; unparseable → 0). */
  price: number;
}

export interface NormalizedIngestOrder {
  externalId: string;
  /** Raw external status string (mapped via StoreOrderStatusMap later). */
  externalStatus: string;
  externalTotal: number;
  currency: string;
  externalCreatedAt: Date | null;
  externalUpdatedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  /** The store's own shipping charge when the payload carried one; null =
   * the payload carries no shipping information at all (the order then
   * keeps the tenant-derived charge). 0 is a real value: the store
   * charged no shipping. */
  externalShipping: number | null;
  /** Customer note from the store (Woo `customer_note` / Shopify `note`);
   * null when the store order has none. */
  customerNote: string | null;
  /** Canonical billing address (same shape as `shippingAddress`); sparse
   * or empty when the payload carries no billing address. */
  billingAddress: Record<string, unknown>;
  shippingAddress: Record<string, unknown>;
  items: NormalizedIngestItem[];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asQuantity(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pickName(...candidates: unknown[]): string {
  for (const c of candidates) {
    const s = asString(c).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Delivery identity (§4.1): sha256(storeId + provider delivery id) on the
 * UNIQUE `StoreWebhookDelivery.deliveryKey` column. A body hash is NOT an
 * event identity — the same payload can arrive on two legitimate deliveries.
 */
export function buildStoreDeliveryKey(storeId: string, deliveryId: string): string {
  return createHash('sha256').update(`${storeId}:${deliveryId}`).digest('hex');
}

/**
 * Job identity shared by the webhook and reconcile paths (BR-11/BR-12):
 * both funnels resolve to the same key so the two paths cannot double-work.
 * The worker treats `store:{storeId}:order:{externalId}` as the execution
 * identity; `StoreOrderMapping` + `Order.idempotencyKey` enforce it in the DB.
 */
export function buildStoreOrderIdentity(storeId: string, externalId: string): {
  idempotencyKey: string;
  objectKey: string;
} {
  const idempotencyKey = `store:${storeId}:order:${externalId}`;
  return { idempotencyKey, objectKey: idempotencyKey };
}

/**
 * Normalize one provider order payload. Accepts:
 *  - WooCommerce REST (`id`, `status`, `total`, `currency`, `date_created`,
 *    `line_items[]` with `sku/quantity/price/name`, `billing{}`);
 *  - Shopify REST (`id`, `financial_status`, `total_price`, `line_items[]`
 *    with `sku/quantity/price/title`, `customer{}`, `created_at`);
 *  - Custom bridge v1 / FakeProvider fixtures (`id`, `status`, `total`,
 *    `currency`, `createdAt`, `items[]` with `sku/qty/price`, `customer{}`).
 * Unknown shapes yield an order with empty items (SKU resolution then raises
 * UNMATCHED_SKU per item — never a throw here).
 */
/**
 * Canonicalize a store-supplied address (Woo `address_1` / `address_2` /
 * `postcode` / BD state code, Shopify `address1` / `zip` / `province`,
 * bridge `addressLine` / `zip`) into the shape the admin display + order
 * snapshot read (`address` / `addressLine`, `city`, `zone`, `state`,
 * `division`, `zip` / `postalCode` / `postcode`, `country`, `phone`).
 *
 * Deliberately emits `zone` (the district name) and NOT `district`:
 * `orders.service.create()` derives the tenant delivery charge from
 * `dto.district || shippingAddress.district`, and a `no_delivery` zone
 * would THROW and lose the external order (BR-13). `zone` is display-only,
 * so the district is visible without ever touching the derivation.
 * A Woo state code (`BD-13`) resolves to the district name, and `state` /
 * `division` carry the division name; an unknown code or a plain state
 * name is kept verbatim (fail-safe). Empty values are omitted so providers
 * that send no address (Shopify fetch does not request addresses) keep
 * their stored shape unchanged.
 */
export function canonicalizeExternalAddress(
  raw: unknown,
  fallback?: Record<string, unknown>,
): Record<string, unknown> {
  const a = (raw ?? {}) as Record<string, unknown>;
  const f = fallback ?? {};
  const out: Record<string, unknown> = {};

  const line1 =
    asString(a.address_1) ||
    asString(a.address1) ||
    asString(a.address) ||
    asString(a.addressLine) ||
    asString(a.street) ||
    asString(a.line1);
  const line2 = asString(a.address_2) || asString(a.address2) || asString(a.line2);
  const street = [line1, line2].filter(Boolean).join(', ');
  if (street) {
    out.address = street;
    out.addressLine = street;
  }

  const city = asString(a.city) || asString(f.city) || asString(a.thana);
  if (city) out.city = city;

  const rawState =
    asString(a.state) || asString(a.province) || asString(a.state_code);
  if (rawState) {
    const district = resolveDistrictFromWooStateCode(rawState);
    if (district) {
      // Woo BD state code → district name (zone) + division name.
      out.zone = district;
      const division = resolveDivision(district);
      if (division) {
        out.state = division;
        out.division = division;
      }
      out.stateCode = rawState.trim().toUpperCase();
    } else {
      // Plain state name (or an unknown code — kept verbatim, fail-safe).
      // A known district name resolves to its division; anything else
      // (e.g. a US state) stays as the state.
      const division = resolveDivision(rawState);
      if (division) {
        out.zone = rawState.trim();
        out.state = division;
        out.division = division;
      } else {
        out.state = rawState.trim();
      }
    }
  }

  const zip =
    asString(a.postcode) ||
    asString(a.zip) ||
    asString(a.postalCode) ||
    asString(f.postcode) ||
    asString(f.zip) ||
    asString(f.postalCode);
  if (zip) {
    out.zip = zip;
    out.postalCode = zip;
    out.postcode = zip;
  }

  const country =
    asString(a.country) || asString(a.country_code) || asString(f.country);
  if (country) out.country = country;

  const phone = asString(a.phone) || asString(f.phone);
  if (phone) out.phone = phone;

  return out;
}

/**
 * The store's own shipping charge, when the payload carries one.
 * Woo: `shipping_lines[]` with `total` per line (present-but-empty means
 * the store charged no shipping → 0). Shopify: `shipping_lines[].price`
 * (the Shopify fetch does not request shipping lines, so this stays null
 * there and the tenant-derived charge is kept). Legacy fallbacks:
 * `shipping_total` / `total_shipping`. Returns null when the payload
 * carries no shipping information at all — null is "unknown", NOT 0.
 */
export function extractExternalShipping(
  raw: Record<string, unknown>,
): number | null {
  const lines = (raw as any).shipping_lines;
  if (Array.isArray(lines)) {
    return Math.max(
      0,
      lines.reduce(
        (sum: number, line: any) => sum + asNumber(line?.total ?? line?.price),
        0,
      ),
    );
  }
  const total = (raw as any).shipping_total ?? (raw as any).total_shipping;
  if (total !== undefined && total !== null && total !== '') {
    return Math.max(0, asNumber(total));
  }
  return null;
}

export function normalizeOrder(raw: Record<string, unknown>): NormalizedIngestOrder {
  const r = raw ?? {};
  const externalId = pickName(r.id, r.number, r.name, r.order_id) || 'unknown';

  const lineItems = Array.isArray(r.line_items)
    ? (r.line_items as Record<string, unknown>[])
    : Array.isArray(r.items)
      ? (r.items as Record<string, unknown>[])
      : [];

  const items: NormalizedIngestItem[] = lineItems.map((li) => ({
    sku: pickName(li.sku, li.product_sku, li.variant_sku),
    name: pickName(li.name, li.title, li.product_name),
    quantity: asQuantity(li.quantity ?? li.qty),
    price: asNumber(li.price ?? li.unit_price ?? li.total),
  }));

  const billing = (r.billing ?? {}) as Record<string, unknown>;
  const shipping = (r.shipping ?? {}) as Record<string, unknown>;
  const customer = (r.customer ?? {}) as Record<string, unknown>;

  const customerPhone = pickName(
    billing.phone, customer.phone, r.phone, shipping.phone,
  ) || null;
  const customerName = pickName(
    [billing.first_name, billing.last_name].filter(Boolean).join(' '),
    customer.name, r.customer_name,
    [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    billing.name,
  ) || null;
  const customerEmail = pickName(billing.email, customer.email, r.email) || null;

  const createdRaw = asString(r.createdAt ?? r.created_at ?? r.date_created ?? r.date_created_gmt);
  const updatedRaw = asString(r.updatedAt ?? r.updated_at ?? r.date_modified ?? r.date_modified_gmt);
  const createdMs = createdRaw ? Date.parse(createdRaw) : NaN;
  const updatedMs = updatedRaw ? Date.parse(updatedRaw) : NaN;

  // Canonical addresses: raw provider keys stay for provenance, canonical
  // keys win where both exist. Shipping falls back to billing for
  // city/country/phone/postcode when the store left them blank.
  const canonicalShipping = canonicalizeExternalAddress(shipping, billing);
  const canonicalBilling = canonicalizeExternalAddress(billing);
  const customerNote =
    asString(r.customer_note) || asString(r.note) || null;

  return {
    externalId,
    externalStatus: pickName(r.status, r.financial_status, r.order_status) || 'pending',
    externalTotal: asNumber(r.total ?? r.total_price ?? r.grand_total),
    currency: pickName(r.currency ?? r.currency_code, r.presentment_currency) || 'BDT',
    externalCreatedAt: Number.isFinite(createdMs) ? new Date(createdMs) : null,
    externalUpdatedAt: Number.isFinite(updatedMs) ? new Date(updatedMs) : null,
    customerName,
    customerPhone,
    customerEmail,
    externalShipping: extractExternalShipping(r),
    customerNote,
    billingAddress: {
      ...(billing && typeof billing === 'object' ? billing : {}),
      ...canonicalBilling,
    },
    shippingAddress: {
      ...(shipping && typeof shipping === 'object' ? shipping : {}),
      ...canonicalShipping,
    },
    items,
  };
}

/** P6 §8.5 widening bounds (BR-10): default window + hard max + page cap. */
export const RECONCILE_DEFAULT_WINDOW_DAYS = 3;
export const RECONCILE_MAX_WINDOW_DAYS = 30;
/**
 * Phase 9 P2 — recovery-cap review. The old bound (20 pages × 50 =
 * 1,000 orders/store/hour) cannot recover a one-hour webhook outage at
 * lakhs/day, and it was the SOLE safety net. New bound: 50 pages ×
 * 100 = **5,000 orders per store per run**.
 *
 * Why 5,000, and why not more:
 *  - Page size 100 is the Woo `per_page` maximum (Shopify clamps to
 *    250, the custom bridge to 100) — fewer round trips per order
 *    than 50, no provider exceeds its own max.
 *  - At ~200ms–1s per order of inline sequential ingest, 5,000
 *    orders is ~15–80 minutes of worker time per store — already a
 *    long run on a concurrency-2 reconcile processor. Raising the
 *    cap further would let one store's recovery monopolize the
 *    worker; instead the run SEGMENTS (see RECONCILE_SEGMENT_PAGES)
 *    and a capped run enqueues a CONTINUATION run that resumes from
 *    the exact page/cursor (see store-order-reconcile.service.ts),
 *    so a large backlog drains across runs instead of truncating.
 *  - The per-order cost above is a reasoned estimate from the query
 *    pattern, not a measurement — the k6 load test (follow-up) may
 *    move these numbers. They are defensible, not final.
 */
export const RECONCILE_MAX_PAGES = 50;
export const RECONCILE_PAGE_SIZE = 100;
/** Segment size for run progress: a checkpoint item is recorded on
 *  the run every 10 pages (1,000 orders), so a long recovery is
 *  visible in the Sync Center instead of looking stalled. */
export const RECONCILE_SEGMENT_PAGES = 10;
/** Orders covered by one full run at the cap (MAX_PAGES × PAGE_SIZE). */
export const RECONCILE_MAX_ORDERS_PER_RUN =
  RECONCILE_MAX_PAGES * RECONCILE_PAGE_SIZE;

/**
 * Clamp a requested reconcile window to the BR-10 bounds. Returns the
 * effective window plus whether widening applied (recorded on the run as
 * `windowDays` + `wideningReason`).
 */
export function clampReconcileWindow(opts: {
  requestedDays?: number;
  wideningReason?: string;
  wideningEnabled: boolean;
}): { windowDays: number; wideningReason: string | null; widened: boolean } {
  const requested = opts.requestedDays ?? RECONCILE_DEFAULT_WINDOW_DAYS;
  if (requested <= RECONCILE_DEFAULT_WINDOW_DAYS) {
    return { windowDays: RECONCILE_DEFAULT_WINDOW_DAYS, wideningReason: null, widened: false };
  }
  // Widening is opt-in, failure-driven, bounded (BR-10): without the flag or
  // a recorded reason the window stays at the 3-day default.
  if (!opts.wideningEnabled || !opts.wideningReason) {
    return { windowDays: RECONCILE_DEFAULT_WINDOW_DAYS, wideningReason: null, widened: false };
  }
  return {
    windowDays: Math.min(Math.floor(requested), RECONCILE_MAX_WINDOW_DAYS),
    wideningReason: opts.wideningReason,
    widened: true,
  };
}
