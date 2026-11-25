/**
 * WooCommerce variable-product push (Phase 9, 2026-11-25): three gaps found
 * by code verification before the 100% live variable test —
 *
 * GAP 1 — the parent `attributes` array was never sent, so a fresh variable
 * product was created in Woo with an empty attribute list (no Size/Color
 * definitions, no storefront variation selector). The core now derives
 * `__variantAttributeDefs` from the current variants and rides them on
 * the parent upsert (create AND update); this mapper turns them into
 * Woo `attributes` with `variation: true` (Woo defaults it to false).
 *
 * GAP 2 — variation `attributes` were attached by the core
 * (`{Size: 'S'}`) but `upsertVariants` copied only sku/price/status and
 * never read them. Variations are now sent as `[{name, option}]` on POST
 * and PUT (including the 404-fallback re-POST).
 *
 * GAP 3 — variant images were dropped at three layers. The core now
 * carries the PushMediaService-verified absolute URL per variant; the
 * provider sends it as variation `image: {src}`. A relative URL is
 * never sent (defence in depth — the core guarantees absolute, this
 * mapper drops anything else instead of 400ing or dead-linking).
 *
 * All assertions are fake-Woo request-body assertions (same pattern as
 * `woocommerce-category-id.spec.ts`): the mock records every request
 * body, and the tests read what Woo would actually receive.
 */
import {
  WooCommerceProvider,
  wooFieldToPayload,
} from '../woocommerce.provider';
import { MockFetch, buildStoreUnit, jsonResponse } from './fixtures';

const STORE = () => buildStoreUnit('WOOCOMMERCE');
const DEFS = [{ name: 'Size', options: ['S', 'M'] }];
const ABS_S = 'https://features-test-store.staging.faah.net/uploads/var-s.jpg';
const ABS_M = 'https://features-test-store.staging.faah.net/uploads/var-m.jpg';

/** Fake Woo serving product create/update AND variation create/update. */
function fakeWoo() {
  const mock = new MockFetch();
  const variations = new Map<string, Record<string, unknown>>();
  let varSeq = 300;
  mock.onAll((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/products?sku=')) return jsonResponse(200, []);
    const varMatch = /\/products\/(\d+)\/variations(?:\/(\d+))?$/.exec(url);
    if (varMatch) {
      const vid = varMatch[2];
      if (method === 'POST' && !vid) {
        varSeq += 1;
        const id = String(varSeq);
        variations.set(id, JSON.parse((init?.body as string) ?? '{}'));
        return jsonResponse(201, { id: Number(id) });
      }
      if (method === 'PUT' && vid) {
        if (vid === 'dead-99') {
          return jsonResponse(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
        }
        if (!variations.has(vid)) {
          return jsonResponse(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
        }
        variations.set(vid, JSON.parse((init?.body as string) ?? '{}'));
        return jsonResponse(200, { id: Number(vid) });
      }
      return jsonResponse(405, { code: 'rest_method_not_allowed' });
    }
    if (url.endsWith('/products') && method === 'POST') {
      return jsonResponse(201, { id: 200 });
    }
    if (/\/products\/\d+$/.test(url) && method === 'PUT') {
      return jsonResponse(200, { id: 200 });
    }
    return jsonResponse(404, { message: 'no mock' });
  });
  return mock;
}

function bodies(mock: MockFetch, method: string, pattern: RegExp): Record<string, unknown>[] {
  return mock.calls
    .filter((c) => (c.init as any)?.method === method && pattern.test(c.url))
    .map((c) => JSON.parse(String((c.init as any)?.body ?? '{}')));
}

describe('wooFieldToPayload parent attributes (GAP 1)', () => {
  it('maps __variantAttributeDefs to Woo attributes with variation:true', () => {
    const out = wooFieldToPayload({ __variantAttributeDefs: DEFS });
    expect(out.attributes).toEqual([
      { name: 'Size', options: ['S', 'M'], visible: true, variation: true },
    ]);
  });

  it('maps several attributes, options as strings, order preserved', () => {
    const out = wooFieldToPayload({
      __variantAttributeDefs: [
        { name: 'Color', options: ['Red', 'Blue'] },
        { name: 'Size', options: ['42', '44'] },
      ],
    });
    expect(out.attributes).toEqual([
      { name: 'Color', options: ['Red', 'Blue'], visible: true, variation: true },
      { name: 'Size', options: ['42', '44'], visible: true, variation: true },
    ]);
  });

  it('drops defs with no usable options and omits attributes when empty', () => {
    expect(
      wooFieldToPayload({ __variantAttributeDefs: [{ name: 'Size', options: [] }] }),
    ).not.toHaveProperty('attributes');
    expect(wooFieldToPayload({ __variantAttributeDefs: [] })).not.toHaveProperty('attributes');
    expect(wooFieldToPayload({})).not.toHaveProperty('attributes');
  });

  it('ignores the raw variantAttributes value (attribute-value ids, never names)', () => {
    // The core must resolve names before this mapper runs; the mapper
    // only reads the resolved defs key.
    const out = wooFieldToPayload({
      variantAttributes: [{ sku: 'V-1', attrs: ['av-size-s'] }],
    });
    expect(out).not.toHaveProperty('attributes');
  });
});

describe('WooCommerceProvider upsertProduct variable create/update (GAP 1)', () => {
  it('create POSTs parent attributes + integer category id for a categorized variable product', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    const ref = await provider.upsertProduct(
      STORE(),
      {
        sku: 'VAR-TEST-001',
        name: 'Variable Push Test',
        productType: 'variable',
        category: '456',
        __variantAttributeDefs: DEFS,
      },
      ['sku', 'name', 'productType', 'category'],
    );
    expect(ref.providerId).toBe('200');
    const [body] = bodies(mock, 'POST', /\/products$/);
    expect(body!.type).toBe('variable');
    expect(body!.attributes).toEqual([
      { name: 'Size', options: ['S', 'M'], visible: true, variation: true },
    ]);
    // Category regression (b1b941cb): still the mapped INTEGER id.
    expect(body!.categories).toEqual([{ id: 456 }]);
  });

  it('update PUTs the same parent attributes', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.upsertProduct(
      STORE(),
      {
        sku: 'VAR-TEST-001',
        productType: 'variable',
        __variantAttributeDefs: DEFS,
        __externalId: '200',
      },
      ['productType'],
    );
    const [body] = bodies(mock, 'PUT', /\/products\/\d+$/);
    expect(body!.attributes).toEqual([
      { name: 'Size', options: ['S', 'M'], visible: true, variation: true },
    ]);
  });
});

describe('WooCommerceProvider upsertVariants attributes + image (GAP 2 + 3)', () => {
  it('POST sends variation attributes as [{name, option}] and image {src}', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.upsertVariants(STORE(), { providerId: '200' }, [
      { sku: 'VAR-TEST-S', price: '100', attributes: { Size: 'S' }, image: ABS_S },
      { sku: 'VAR-TEST-M', price: '120', attributes: { Size: 'M' }, image: ABS_M },
    ] as any);
    expect(out.get('VAR-TEST-S')?.providerId).toBe('301');
    expect(out.get('VAR-TEST-M')?.providerId).toBe('302');
    const posts = bodies(mock, 'POST', /\/variations$/);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      sku: 'VAR-TEST-S',
      regular_price: '100',
      attributes: [{ name: 'Size', option: 'S' }],
      image: { src: ABS_S },
    });
    expect(posts[1]).toMatchObject({
      sku: 'VAR-TEST-M',
      regular_price: '120',
      attributes: [{ name: 'Size', option: 'M' }],
      image: { src: ABS_M },
    });
  });

  it('PUT sends the same attributes + image on update (no duplicate)', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    const ref = { providerId: '200' };
    const first = await provider.upsertVariants(STORE(), ref, [
      { sku: 'VAR-TEST-S', price: '100', attributes: { Size: 'S' }, image: ABS_S },
    ] as any);
    const id = first.get('VAR-TEST-S')!.providerId;
    mock.calls.length = 0;
    await provider.upsertVariants(STORE(), ref, [
      { sku: 'VAR-TEST-S', price: '110', attributes: { Size: 'S' }, image: ABS_S, __externalVariantId: id },
    ] as any);
    expect(mock.calls.filter((c) => (c.init as any)?.method === 'PUT')).toHaveLength(1);
    expect(mock.calls.filter((c) => (c.init as any)?.method === 'POST')).toHaveLength(0);
    const [body] = bodies(mock, 'PUT', /\/variations\/\d+$/);
    expect(body).toMatchObject({
      regular_price: '110',
      attributes: [{ name: 'Size', option: 'S' }],
      image: { src: ABS_S },
    });
  });

  it('stale __externalVariantId (PUT 404) falls back to POST with attributes + image', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.upsertVariants(STORE(), { providerId: '200' }, [
      { sku: 'VAR-TEST-S', price: '100', attributes: { Size: 'S' }, image: ABS_S, __externalVariantId: 'dead-99' },
    ] as any);
    expect(out.get('VAR-TEST-S')?.providerId).toBe('301');
    expect(mock.calls.map((c) => (c.init as any)?.method)).toEqual(['PUT', 'POST']);
    const [body] = bodies(mock, 'POST', /\/variations$/);
    expect(body).toMatchObject({
      attributes: [{ name: 'Size', option: 'S' }],
      image: { src: ABS_S },
    });
  });

  it('omits attributes when the variant carries none, and image when unset', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.upsertVariants(STORE(), { providerId: '200' }, [
      { sku: 'VAR-TEST-S', price: '100', attributes: {} },
    ] as any);
    const [body] = bodies(mock, 'POST', /\/variations$/);
    expect(body).not.toHaveProperty('attributes');
    expect(body).not.toHaveProperty('image');
  });

  it('never sends a relative variant image URL to Woo (defence in depth)', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.upsertVariants(STORE(), { providerId: '200' }, [
      { sku: 'VAR-TEST-S', price: '100', attributes: { Size: 'S' }, image: '/uploads/var-s.jpg' },
    ] as any);
    const [body] = bodies(mock, 'POST', /\/variations$/);
    expect(body).not.toHaveProperty('image');
    expect(JSON.stringify(body)).not.toContain('/uploads/');
  });

  it('sends several attributes per variation, empty values dropped', async () => {
    const mock = fakeWoo();
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.upsertVariants(STORE(), { providerId: '200' }, [
      {
        sku: 'VAR-TEST-S',
        price: '100',
        attributes: { Size: 'S', Color: 'Red', Material: '' },
      },
    ] as any);
    const [body] = bodies(mock, 'POST', /\/variations$/);
    expect(body!.attributes).toEqual([
      { name: 'Size', option: 'S' },
      { name: 'Color', option: 'Red' },
    ]);
  });
});
