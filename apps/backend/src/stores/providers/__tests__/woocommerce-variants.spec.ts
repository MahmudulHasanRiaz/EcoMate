/**
 * WooCommerce `upsertVariants` — PUT vs POST routing + stale-id fallback (V1).
 *
 * Proves the provider half of the Phase 1 fix against a stubbed Woo REST
 * API: a variant WITHOUT `__externalVariantId` is always POST-created; one
 * WITH it is PUT-updated; a stale id (PUT 404) falls back to POST create
 * instead of failing the sync; any other PUT failure still propagates.
 */
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import { WooCommerceProvider } from '../woocommerce.provider';
import { MockFetch, buildStoreUnit, jsonResponse } from './fixtures';

const STORE = () => buildStoreUnit('WOOCOMMERCE');

/** Minimal in-memory Woo variations endpoint (per-product id map). */
function wired() {
  const mock = new MockFetch();
  const variations = new Map<string, Map<string, Record<string, unknown>>>();
  let seq = 0;
  mock.onAll((url, init) => {
    const method = init?.method ?? 'GET';
    const m = /\/wp-json\/wc\/v3\/products\/([^/]+)\/variations(?:\/([^/?]+))?/.exec(url);
    if (!m) return jsonResponse(404, { code: 'rest_no_route', message: 'no such route' });
    const pid = decodeURIComponent(m[1]!);
    const vid = m[2] ? decodeURIComponent(m[2]) : undefined;
    let list = variations.get(pid);
    if (!list) {
      list = new Map();
      variations.set(pid, list);
    }
    if (method === 'POST' && !vid) {
      seq += 1;
      const id = String(seq);
      list.set(id, { id, ...(JSON.parse((init?.body as string) ?? '{}') as object) });
      return jsonResponse(201, { id: Number(id) });
    }
    if (method === 'PUT' && vid) {
      if (vid === 'boom') return jsonResponse(500, { code: 'internal_error', message: 'boom' });
      const slot = list.get(vid);
      if (!slot) return jsonResponse(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
      list.set(vid, { ...slot, ...(JSON.parse((init?.body as string) ?? '{}') as object) });
      return jsonResponse(200, { id: Number(vid) });
    }
    return jsonResponse(405, { code: 'rest_method_not_allowed' });
  });
  const provider = new WooCommerceProvider(mock.fetch);
  const count = (pid: string) => variations.get(pid)?.size ?? 0;
  return { provider, mock, count };
}

describe('WooCommerce upsertVariants (V1)', () => {
  it('POSTs a new variation when no __externalVariantId is given', async () => {
    const { provider, mock, count } = wired();
    const out = await provider.upsertVariants(STORE(), { providerId: 'prod-1' }, [
      { sku: 'V-1', price: '10' },
    ] as any);
    expect(out.get('V-1')?.providerId).toBe('1');
    expect(count('prod-1')).toBe(1);
    expect(mock.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);
    expect(mock.calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
  });

  it('PUTs the existing variation when __externalVariantId is given (no duplicate)', async () => {
    const { provider, mock, count } = wired();
    const ref = { providerId: 'prod-1' };
    const first = await provider.upsertVariants(STORE(), ref, [{ sku: 'V-1', price: '10' }] as any);
    const id = first.get('V-1')!.providerId;
    mock.calls.length = 0;
    const second = await provider.upsertVariants(STORE(), ref, [
      { sku: 'V-1', price: '12', __externalVariantId: id },
    ] as any);
    expect(second.get('V-1')?.providerId).toBe(id);
    expect(count('prod-1')).toBe(1);
    expect(mock.calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1);
    expect(mock.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
    expect(mock.calls[0]!.url).toContain(`/variations/${id}`);
  });

  it('stale __externalVariantId (PUT 404) falls back to POST create', async () => {
    const { provider, mock, count } = wired();
    const ref = { providerId: 'prod-1' };
    const out = await provider.upsertVariants(STORE(), ref, [
      { sku: 'V-1', price: '10', __externalVariantId: 'dead-99' },
    ] as any);
    // Re-created with a fresh id — the caller re-points the mapping at it.
    expect(out.get('V-1')?.providerId).toBe('1');
    expect(count('prod-1')).toBe(1);
    const methods = mock.calls.map((c) => c.init?.method);
    expect(methods).toEqual(['PUT', 'POST']);
  });

  it('a non-404 PUT failure still propagates (no silent create)', async () => {
    const { provider, mock } = wired();
    await expect(
      provider.upsertVariants(STORE(), { providerId: 'prod-1' }, [
        { sku: 'V-1', price: '10', __externalVariantId: 'boom' },
      ] as any),
    ).rejects.toMatchObject({ category: ProviderErrorCategory.TEMPORARY_FAILURE });
    expect(mock.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
  });
});
