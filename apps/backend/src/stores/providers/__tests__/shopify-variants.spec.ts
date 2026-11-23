/**
 * Shopify `upsertVariants` — stale-`__externalVariantId` fallback (V1).
 *
 * Shopify never shared the duplication defect (it SKU-matches before
 * creating), but once `syncVariants` passes the mapped id, a stale id
 * would PUT to a dead variant instead of falling back to the SKU match.
 * These tests prove the candidate order against a stubbed Shopify REST
 * API: mapped id → SKU match → create; a non-404 PUT failure propagates.
 */
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import { ShopifyProvider } from '../shopify.provider';
import { MockFetch, buildStoreUnit, jsonResponse } from './fixtures';

const STORE = () => buildStoreUnit('SHOPIFY');
const API = 'https://test-shop.myshopify.com/admin/api/2026-10';

/** Minimal in-memory Shopify variants endpoint + token exchange. */
function wired(seed: Array<{ id: string; sku: string }> = []) {
  const mock = new MockFetch();
  const variants = new Map<string, { id: string; sku: string; price?: string }>(
    seed.map((v) => [v.id, { ...v }]),
  );
  let seq = 100;
  mock.onAll((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/admin/oauth/access_token') && method === 'POST') {
      return jsonResponse(200, { access_token: 'tok-test', expires_in: 3600 });
    }
    const listMatch = /\/products\/([^/]+)\/variants\.json/.exec(url);
    if (listMatch && method === 'GET') {
      return jsonResponse(200, { variants: [...variants.values()] });
    }
    if (listMatch && method === 'POST') {
      seq += 1;
      const body = JSON.parse((init?.body as string) ?? '{}') as any;
      const variant = { id: String(seq), sku: body?.variant?.sku ?? '', price: body?.variant?.price };
      variants.set(variant.id, variant);
      return jsonResponse(201, { variant });
    }
    const putMatch = /\/variants\/([^/]+)\.json/.exec(url);
    if (putMatch && method === 'PUT') {
      const vid = decodeURIComponent(putMatch[1]!);
      if (vid === 'boom') return jsonResponse(500, { errors: 'boom' });
      const slot = variants.get(vid);
      if (!slot) return jsonResponse(404, { errors: 'Not Found' });
      const body = JSON.parse((init?.body as string) ?? '{}') as any;
      const next = { ...slot, ...(body?.variant ?? {}) };
      variants.set(vid, next);
      return jsonResponse(200, { variant: next });
    }
    return jsonResponse(404, { errors: 'no mock' });
  });
  const provider = new ShopifyProvider(mock.fetch);
  const count = () => variants.size;
  return { provider, mock, count };
}

describe('Shopify upsertVariants stale-id fallback (V1)', () => {
  it('stale __externalVariantId + live SKU match → PUTs the SKU-matched variant', async () => {
    const { provider, mock, count } = wired([{ id: 'live-1', sku: 'V-1' }]);
    const out = await provider.upsertVariants(STORE(), { providerId: 'prod-1' }, [
      { sku: 'V-1', price: '12', __externalVariantId: 'dead-99' },
    ] as any);
    expect(out.get('V-1')?.providerId).toBe('live-1');
    expect(count()).toBe(1);
    const puts = mock.calls.filter((c) => c.init?.method === 'PUT');
    expect(puts.map((c) => c.url)).toEqual([
      `${API}/variants/dead-99.json`,
      `${API}/variants/live-1.json`,
    ]);
    expect(mock.calls.filter((c) => c.init?.method === 'POST' && c.url.includes('variants.json'))).toHaveLength(0);
  });

  it('stale __externalVariantId + no SKU match → POST create', async () => {
    const { provider, mock, count } = wired([]);
    const out = await provider.upsertVariants(STORE(), { providerId: 'prod-1' }, [
      { sku: 'V-1', price: '10', __externalVariantId: 'dead-99' },
    ] as any);
    expect(out.get('V-1')?.providerId).toBe('101');
    expect(count()).toBe(1);
    expect(mock.calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1);
    expect(
      mock.calls.filter((c) => c.init?.method === 'POST' && c.url.includes('/products/prod-1/variants.json')),
    ).toHaveLength(1);
  });

  it('live __externalVariantId → single PUT, no create', async () => {
    const { provider, mock, count } = wired([{ id: 'live-1', sku: 'V-1' }]);
    const out = await provider.upsertVariants(STORE(), { providerId: 'prod-1' }, [
      { sku: 'V-1', price: '12', __externalVariantId: 'live-1' },
    ] as any);
    expect(out.get('V-1')?.providerId).toBe('live-1');
    expect(count()).toBe(1);
    expect(mock.calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1);
    expect(mock.calls.filter((c) => c.init?.method === 'POST' && c.url.includes('variants.json'))).toHaveLength(0);
  });

  it('a non-404 PUT failure still propagates (no silent create)', async () => {
    const { provider, mock } = wired([{ id: 'live-1', sku: 'V-1' }]);
    await expect(
      provider.upsertVariants(STORE(), { providerId: 'prod-1' }, [
        { sku: 'V-1', price: '10', __externalVariantId: 'boom' },
      ] as any),
    ).rejects.toMatchObject({ category: ProviderErrorCategory.TEMPORARY_FAILURE });
    expect(mock.calls.filter((c) => c.init?.method === 'POST' && c.url.includes('variants.json'))).toHaveLength(0);
  });
});
