/**
 * Category-id bug (found live on staging 2026-11-25): pushing a categorized
 * product to Woo 400d with `categories[0][id] is not of type integer` — the
 * sync sent the tenant category UUID as the Woo category id. The core now
 * resolves the category to the mapped remote term id before the field loop,
 * and the Woo payload sends real integers. The bridge had the same leak
 * (tenant UUID in `category_ids`); Shopify never leaks it (its payload
 * mapper never reads `input.category` — asserted here so a future edit
 * cannot silently reintroduce it).
 */
import {
  WooCommerceProvider,
  wooFieldToPayload,
  wooProductToSnapshots,
} from '../woocommerce.provider';
import {
  bridgeFieldToPayload,
  bridgeProductToSnapshots,
} from '../custom-bridge.provider';
import { shopifyFieldToPayload } from '../shopify.provider';
import { hashFieldValue } from '../field-snapshot';
import { MockFetch, buildStoreUnit, jsonResponse } from './fixtures';

const STORE = () => buildStoreUnit('WOOCOMMERCE');
const TENANT_UUID = 'a0b9b458-b058-446a-9453-6802480a14ae';

describe('wooFieldToPayload category ids', () => {
  it('sends the mapped id as an INTEGER (Woo rejects strings)', () => {
    const out = wooFieldToPayload({ category: '456' });
    expect(out.categories).toEqual([{ id: 456 }]);
    expect(typeof (out.categories as { id: unknown }[])[0]!.id).toBe('number');
  });

  it('sends every id in an array as an integer', () => {
    const out = wooFieldToPayload({ category: ['7', '8'] });
    expect(out.categories).toEqual([{ id: 7 }, { id: 8 }]);
  });

  it('drops a tenant UUID instead of 400ing on it (live regression)', () => {
    const out = wooFieldToPayload({ category: TENANT_UUID });
    expect(out).not.toHaveProperty('categories');
  });

  it('drops non-numeric entries but keeps numeric ones', () => {
    const out = wooFieldToPayload({ category: ['456', TENANT_UUID] });
    expect(out.categories).toEqual([{ id: 456 }]);
  });

  it('omits categories for null / undefined', () => {
    expect(wooFieldToPayload({ category: null })).not.toHaveProperty('categories');
    expect(wooFieldToPayload({})).not.toHaveProperty('categories');
  });
});

describe('wooProductToSnapshots category', () => {
  it('carries the single first remote term id as a string', () => {
    const snaps = wooProductToSnapshots(
      { categories: [{ id: 12, name: 'Rule Test' }] },
      ['category'],
    );
    expect(snaps.category!.value).toBe('12');
    expect(snaps.category!.hash).toBe(hashFieldValue('12'));
  });

  it('carries the first id when Woo lists several', () => {
    const snaps = wooProductToSnapshots(
      { categories: [{ id: 12 }, { id: 34 }] },
      ['category'],
    );
    expect(snaps.category!.value).toBe('12');
  });

  it('is null for an uncategorized remote product', () => {
    const snaps = wooProductToSnapshots({ categories: [] }, ['category']);
    expect(snaps.category!.value).toBeNull();
  });
});

describe('WooCommerceProvider upsertProduct (fake Woo, request body)', () => {
  /** Route the SKU probe to "no pre-existing product", everything else to a canned create. */
  function fakeWoo() {
    const mock = new MockFetch();
    mock.onAll((url, init) => {
      if (url.includes('/products?sku=')) return jsonResponse(200, []);
      if (url.endsWith('/products') && init?.method === 'POST') {
        return jsonResponse(201, { id: 200 });
      }
      if (/\/products\/\d+$/.test(url) && init?.method === 'PUT') {
        return jsonResponse(200, { id: 200 });
      }
      return jsonResponse(404, { message: 'no mock' });
    });
    return mock;
  }

  function postBody(mock: MockFetch): Record<string, unknown> {
    const call = mock.calls.find(
      (c) => c.url.endsWith('/products') && (c.init as any)?.method === 'POST',
    );
    expect(call).toBeDefined();
    return JSON.parse(String((call!.init as any)?.body ?? '{}'));
  }

  function putBody(mock: MockFetch): Record<string, unknown> {
    const call = mock.calls.find(
      (c) => /\/products\/\d+$/.test(c.url) && (c.init as any)?.method === 'PUT',
    );
    expect(call).toBeDefined();
    return JSON.parse(String((call!.init as any)?.body ?? '{}'));
  }

  it('create sends categories:[{id: <integer>}] for a categorized product', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    const ref = await provider.upsertProduct(
      STORE(),
      { sku: 'RULE-001', name: 'Rule Match Test', category: '456' },
      ['sku', 'name', 'category'],
    );
    expect(ref.providerId).toBe('200');
    const body = postBody(mock);
    expect(body.categories).toEqual([{ id: 456 }]);
    expect(typeof (body.categories as { id: unknown }[])[0]!.id).toBe('number');
    // The tenant UUID must never appear anywhere in the request body.
    expect(JSON.stringify(body)).not.toContain(TENANT_UUID);
  });

  it('update sends the same integer id on PUT', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.upsertProduct(
      STORE(),
      { sku: 'RULE-001', category: '456', __externalId: '200' },
      ['category'],
    );
    const body = putBody(mock);
    expect(body.categories).toEqual([{ id: 456 }]);
  });

  it('create omits categories for an uncategorized product', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.upsertProduct(
      STORE(),
      { sku: 'NO-CAT-001', name: 'No Category' },
      ['sku', 'name'],
    );
    const body = postBody(mock);
    expect(body).not.toHaveProperty('categories');
  });
});

describe('bridge category ids', () => {
  const caps = { categories: true } as any;

  it('passes the mapped peer id through as a string (protocol shape)', () => {
    const out = bridgeFieldToPayload({ category: '12' }, caps);
    expect(out.category_ids).toEqual(['12']);
  });

  it('snapshot carries the first peer id, or null', () => {
    expect(
      bridgeProductToSnapshots({ category_ids: ['12', '34'] }, ['category'])
        .category!.value,
    ).toBe('12');
    expect(
      bridgeProductToSnapshots({ category_ids: [] }, ['category']).category!
        .value,
    ).toBeNull();
    expect(
      bridgeProductToSnapshots({}, ['category']).category!.value,
    ).toBeNull();
  });
});

describe('Shopify never leaks the tenant category id', () => {
  it('payload mapper ignores input.category entirely', () => {
    const out = shopifyFieldToPayload({
      category: TENANT_UUID,
      name: 'Rule Match Test',
      sku: 'RULE-001',
    });
    expect(out).not.toHaveProperty('product_type');
    expect(JSON.stringify(out)).not.toContain(TENANT_UUID);
    expect(JSON.stringify(out)).not.toContain('categor');
  });
});
