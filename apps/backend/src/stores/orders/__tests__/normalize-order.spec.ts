/**
 * P6 order suite (§13) — normalization + job identity + reconcile bounds.
 * Pure functions: no DB, no network. Deterministic fixtures only.
 */
import {
  normalizeOrder,
  buildStoreDeliveryKey,
  buildStoreOrderIdentity,
  clampReconcileWindow,
  extractExternalShipping,
  canonicalizeExternalAddress,
  RECONCILE_DEFAULT_WINDOW_DAYS,
  RECONCILE_MAX_WINDOW_DAYS,
  RECONCILE_MAX_PAGES,
} from '../normalize-order';
import {
  WOO_BD_STATE_TO_DISTRICT,
  resolveDistrictFromWooStateCode,
  resolveDivision,
} from '../../../delivery-areas/data/district-division';
import { buildOrderFixtures } from '../../providers/__tests__/fixtures';

describe('P6 normalizeOrder — WooCommerce shape', () => {
  it('maps WC REST fields to the canonical shape', () => {
    const out = normalizeOrder({
      id: 4821,
      status: 'processing',
      total: '750.00',
      currency: 'BDT',
      date_created: '2026-09-23T13:00:00',
      line_items: [
        { sku: 'SKU-IN-001', name: 'Tee', quantity: 2, price: '250' },
      ],
      billing: { first_name: 'Sara', last_name: 'K', phone: '01700000001', email: 's@x.test' },
    });
    expect(out.externalId).toBe('4821');
    expect(out.externalStatus).toBe('processing');
    expect(out.externalTotal).toBe(750);
    expect(out.items).toEqual([{ sku: 'SKU-IN-001', name: 'Tee', quantity: 2, price: 250 }]);
    expect(out.customerName).toBe('Sara K');
    expect(out.customerPhone).toBe('01700000001');
    expect(out.customerEmail).toBe('s@x.test');
    expect(out.externalCreatedAt).toBeInstanceOf(Date);
  });
});

describe('P6 normalizeOrder — Shopify shape', () => {
  it('maps Shopify REST fields to the canonical shape', () => {
    const out = normalizeOrder({
      id: 987654321,
      financial_status: 'paid',
      total_price: '500.00',
      presentment_currency: 'BDT',
      created_at: '2026-09-21T11:00:00Z',
      line_items: [{ sku: 'SKU-VAR-RED-M', title: 'Red / M', quantity: 1, price: '400' }],
      customer: { first_name: 'Order', last_name: 'Two', phone: '+8801700000002' },
    });
    expect(out.externalId).toBe('987654321');
    expect(out.externalStatus).toBe('paid');
    expect(out.externalTotal).toBe(500);
    expect(out.currency).toBe('BDT');
    expect(out.items[0]).toMatchObject({ sku: 'SKU-VAR-RED-M', quantity: 1, price: 400 });
  });
});

describe('P6 normalizeOrder — bridge/fixture shape', () => {
  it('normalizes every scripted fixture order', () => {
    for (const f of buildOrderFixtures()) {
      const out = normalizeOrder({ ...f } as unknown as Record<string, unknown>);
      expect(out.externalId).toBe(f.id);
      expect(out.externalStatus).toBe(f.status);
      expect(out.items).toHaveLength(f.items.length);
      expect(out.items[0].sku).toBe(f.items[0].sku);
    }
  });

  it('never throws on unknown shapes — empty items, pending status', () => {
    const out = normalizeOrder({ whatever: true } as any);
    expect(out.items).toEqual([]);
    expect(out.externalStatus).toBe('pending');
    expect(out.externalCreatedAt).toBeNull();
  });

  it('extracts only allowlisted scalars (no secret passthrough)', () => {
    const out = normalizeOrder({
      id: 'x-1',
      consumerSecret: 'SHOULD-NOT-FLOW',
      webhookSecret: 'SHOULD-NOT-FLOW',
      credentials: { key: 'SHOULD-NOT-FLOW' },
    } as any);
    expect(JSON.stringify(out)).not.toContain('SHOULD-NOT-FLOW');
  });
});

describe('P6 job identity (§4.1, BR-11/BR-12)', () => {
  it('deliveryKey = sha256(storeId + delivery id), stable', () => {
    const a = buildStoreDeliveryKey('store-1', 'del-9');
    const b = buildStoreDeliveryKey('store-1', 'del-9');
    const c = buildStoreDeliveryKey('store-1', 'del-10');
    const d = buildStoreDeliveryKey('store-2', 'del-9');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('execution identity is store-scoped (webhook ≡ reconcile)', () => {
    const { idempotencyKey, objectKey } = buildStoreOrderIdentity('store-1', 'ext-5');
    expect(idempotencyKey).toBe('store:store-1:order:ext-5');
    expect(objectKey).toBe(idempotencyKey);
  });
});

describe('P6 reconcile window bounds (BR-10)', () => {
  it('defaults to the 3-day window', () => {
    expect(clampReconcileWindow({ wideningEnabled: true }).windowDays).toBe(
      RECONCILE_DEFAULT_WINDOW_DAYS,
    );
    expect(RECONCILE_DEFAULT_WINDOW_DAYS).toBe(3);
  });

  it('widening without flag or reason stays at 3 days', () => {
    expect(
      clampReconcileWindow({ requestedDays: 10, wideningEnabled: false, wideningReason: 'missed' }),
    ).toMatchObject({ windowDays: 3, widened: false });
    expect(
      clampReconcileWindow({ requestedDays: 10, wideningEnabled: true }),
    ).toMatchObject({ windowDays: 3, widened: false });
  });

  it('opt-in failure-driven widening applies, hard-capped at 30 days', () => {
    expect(
      clampReconcileWindow({ requestedDays: 10, wideningEnabled: true, wideningReason: 'webhook outage 2026-09-20' }),
    ).toMatchObject({ windowDays: 10, widened: true, wideningReason: 'webhook outage 2026-09-20' });
    const capped = clampReconcileWindow({ requestedDays: 90, wideningEnabled: true, wideningReason: 'x' });
    expect(capped.windowDays).toBe(RECONCILE_MAX_WINDOW_DAYS);
    expect(RECONCILE_MAX_WINDOW_DAYS).toBe(30);
    expect(RECONCILE_MAX_PAGES).toBeGreaterThan(0);
  });
});

describe('Woo order-ingest fixes — external shipping (Boss 2026-11-25)', () => {
  it('sums Woo shipping_lines totals', () => {
    expect(extractExternalShipping({ shipping_lines: [{ total: '60.00' }] })).toBe(60);
    expect(
      extractExternalShipping({ shipping_lines: [{ total: '60.00' }, { total: '40' }] }),
    ).toBe(100);
  });

  it('present-but-empty shipping_lines means the store charged no shipping (0)', () => {
    expect(extractExternalShipping({ shipping_lines: [] })).toBe(0);
  });

  it('falls back to shipping_total / total_shipping when there are no lines', () => {
    expect(extractExternalShipping({ shipping_total: '25.50' })).toBe(25.5);
    expect(extractExternalShipping({ total_shipping: '10' })).toBe(10);
  });

  it('null when the payload carries no shipping information at all (not 0)', () => {
    expect(extractExternalShipping({})).toBeNull();
    // Shopify fetch does not request shipping lines — null keeps the
    // tenant-derived charge for those orders, exactly as before.
    expect(extractExternalShipping({ financial_status: 'paid', total_price: '500' })).toBeNull();
  });

  it('never returns a negative charge', () => {
    expect(extractExternalShipping({ shipping_lines: [{ total: '-10' }] })).toBe(0);
  });
});

describe('Woo order-ingest fixes — customer note (Boss 2026-11-25)', () => {
  it('reads Woo customer_note', () => {
    const out = normalizeOrder({
      id: 'ext-1', status: 'processing', total: '150', currency: 'BDT',
      customer_note: 'Please call before delivery',
      line_items: [{ sku: 'SKU-1', quantity: 1, price: '150' }],
    });
    expect(out.customerNote).toBe('Please call before delivery');
  });

  it('reads Shopify note', () => {
    const out = normalizeOrder({
      id: 'ext-2', financial_status: 'paid', total_price: '500',
      note: 'Leave at the gate',
      line_items: [{ sku: 'SKU-1', quantity: 1, price: '500' }],
    });
    expect(out.customerNote).toBe('Leave at the gate');
  });

  it('null when the store order has no note (live #221: empty note)', () => {
    const out = normalizeOrder({
      id: 'ext-3', status: 'processing', total: '150',
      line_items: [{ sku: 'SKU-1', quantity: 1, price: '150' }],
    });
    expect(out.customerNote).toBeNull();
  });
});

describe('Woo order-ingest fixes — address canonicalization (Boss 2026-11-25)', () => {
  // Live reference shape: Woo #221 (ORD-261125-0001) — address_1
  // "Dhaka, bari", city Dhaka, postcode 1229, state BD-13, country BD.
  const woo221 = {
    id: 'ext-221',
    status: 'processing',
    total: '150',
    currency: 'BDT',
    billing: {
      first_name: 'Riaz', last_name: 'Test', phone: '016013015876', email: 'mahhj@ff.jg',
      address_1: 'Dhaka, bari', city: 'Dhaka', state: 'BD-13', postcode: '1229', country: 'BD',
    },
    shipping: {
      first_name: 'Riaz', last_name: 'Test', phone: '016013015876',
      address_1: 'Dhaka, bari', city: 'Dhaka', state: 'BD-13', postcode: '1229', country: 'BD',
    },
    line_items: [{ sku: 'SIMPLE-IMG-001', quantity: 1, price: '150' }],
  };

  it('canonicalizes the Woo #221 address (street + city + postcode + BD-13 → Dhaka)', () => {
    const out = normalizeOrder(woo221);
    expect(out.shippingAddress).toMatchObject({
      address: 'Dhaka, bari',
      addressLine: 'Dhaka, bari',
      city: 'Dhaka',
      zone: 'Dhaka',
      state: 'Dhaka',
      division: 'Dhaka',
      stateCode: 'BD-13',
      zip: '1229',
      postalCode: '1229',
      postcode: '1229',
      country: 'BD',
      phone: '016013015876',
    });
    // Raw provider keys stay for provenance.
    expect(out.shippingAddress.address_1).toBe('Dhaka, bari');
    expect(out.shippingAddress.postcode).toBe('1229');
  });

  it('canonicalizes the billing address too (no longer Null)', () => {
    const out = normalizeOrder(woo221);
    expect(out.billingAddress).toMatchObject({
      address: 'Dhaka, bari',
      city: 'Dhaka',
      zone: 'Dhaka',
      state: 'Dhaka',
      zip: '1229',
      country: 'BD',
    });
  });

  it('joins address_1 + address_2 and falls back to billing phone when shipping has none', () => {
    const out = normalizeOrder({
      id: 'ext-4', status: 'processing', total: '100',
      billing: { phone: '01700000001', address_1: 'House 1', city: 'Dhaka', country: 'BD' },
      shipping: { address_1: 'House 1', address_2: 'Road 2, Dhanmondi', city: 'Dhaka', state: 'BD-13', postcode: '1205', country: 'BD' },
      line_items: [{ sku: 'SKU-1', quantity: 1, price: '100' }],
    });
    expect(out.shippingAddress.address).toBe('House 1, Road 2, Dhanmondi');
    expect(out.shippingAddress.phone).toBe('01700000001');
  });

  it('never emits a district key (the delivery-charge derivation reads it; a no_delivery zone must not lose the order)', () => {
    const out = normalizeOrder(woo221);
    expect(out.shippingAddress).not.toHaveProperty('district');
    expect(out.shippingAddress).toHaveProperty('zone', 'Dhaka');
  });

  it('keeps an unknown state code verbatim (fail-safe, never a wrong district)', () => {
    const out = canonicalizeExternalAddress({ state: 'BD-99', city: 'Dhaka' });
    expect(out.state).toBe('BD-99');
    expect(out).not.toHaveProperty('zone');
  });

  it('resolves a plain district name to its division; a non-BD state stays as-is', () => {
    expect(canonicalizeExternalAddress({ state: 'Chittagong' })).toMatchObject({
      zone: 'Chittagong',
      state: 'Chittagong',
      division: 'Chittagong',
    });
    expect(canonicalizeExternalAddress({ state: 'California' })).toMatchObject({
      state: 'California',
    });
  });

  it('leaves a provider with no address shape unchanged (Shopify/bridge)', () => {
    expect(canonicalizeExternalAddress({})).toEqual({});
    expect(canonicalizeExternalAddress(undefined)).toEqual({});
  });
});

describe('Woo order-ingest fixes — BD state-code table (Boss 2026-11-25)', () => {
  it('has all 64 ISO 3166-2:BD codes, each resolving to a district with a division', () => {
    const codes = Object.keys(WOO_BD_STATE_TO_DISTRICT);
    expect(codes).toHaveLength(64);
    for (const code of codes) {
      expect(code).toMatch(/^BD-\d{2}$/);
      const district = resolveDistrictFromWooStateCode(code);
      expect(district).toBeTruthy();
      expect(resolveDivision(district)).toBeTruthy();
    }
  });

  it('maps the live-verified codes (BD-13 = Dhaka, BD-10 = Chittagong, BD-03 = Bogura)', () => {
    expect(resolveDistrictFromWooStateCode('BD-13')).toBe('Dhaka');
    expect(resolveDivision('Dhaka')).toBe('Dhaka');
    expect(resolveDistrictFromWooStateCode('BD-10')).toBe('Chittagong');
    expect(resolveDistrictFromWooStateCode('BD-03')).toBe('Bogura');
    expect(resolveDistrictFromWooStateCode('bd-13')).toBe('Dhaka');
    expect(resolveDistrictFromWooStateCode('BD-99')).toBeUndefined();
  });
});
