/**
 * WooCommerce product-import provider methods (§6.2–6.3).
 *
 * Proves listProducts / listVariations / fetchProduct against a stubbed
 * Woo REST API: query params (page/per_page cap, one request per status —
 * Woo 11.3.1 rejects a comma-joined status with rest_invalid_param,
 * modified_after + order, include[]), the merge of per-status pages
 * (dedupe, summed total, hasMore while ANY status has more pages), the
 * header-aware wooPage() helper (X-WP-Total / X-WP-TotalPages), the 30s
 * AbortSignal timeout on woo(), and snapshotsFromProductBody (no extra GET
 * for baseline seeding).
 */
import { ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import { WooCommerceProvider } from '../woocommerce.provider';
import { MockFetch, buildStoreUnit, jsonResponse } from './fixtures';

const STORE = () => buildStoreUnit('WOOCOMMERCE');

function productsRoute(total: number, totalPages: number, body: unknown[]) {
  return (url: string) => {
    void url;
    return jsonResponse(200, body, {
      'x-wp-total': String(total),
      'x-wp-totalpages': String(totalPages),
    });
  };
}

describe('WooCommerce listProducts (§6.3)', () => {
  /** Per-status handler: answers each status with its own body + headers. */
  function perStatusRoute(
    byStatus: Record<string, { body: unknown[]; total?: number; totalPages?: number }>,
  ) {
    return (url: string) => {
      const status = new URL(url).searchParams.get('status') ?? '';
      const hit = byStatus[status] ?? { body: [] };
      const headers: Record<string, string> = {};
      if (hit.total !== undefined) headers['x-wp-total'] = String(hit.total);
      if (hit.totalPages !== undefined) headers['x-wp-totalpages'] = String(hit.totalPages);
      return jsonResponse(200, hit.body, headers);
    };
  }

  it('sends page/per_page (capped at 100) + one request per default status', async () => {
    const mock = new MockFetch();
    mock.onAll(
      perStatusRoute({
        publish: { body: [{ id: 1, name: 'A' }], total: 1, totalPages: 1 },
        draft: { body: [], total: 0, totalPages: 0 },
      }),
    );
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.listProducts(STORE(), { page: 2, pageSize: 250 });
    expect(mock.calls).toHaveLength(2);
    for (const { url } of mock.calls) {
      expect(url).toContain('/wp-json/wc/v3/products?');
      expect(url).toContain('page=2');
      expect(url).toContain('per_page=100');
      // Woo 11.3.1 rejects a comma-joined status (rest_invalid_param).
      expect(url).not.toContain('%2C');
    }
    expect(mock.calls[0]!.url).toContain('status=publish');
    expect(mock.calls[1]!.url).toContain('status=draft');
    expect(out.products).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it('merges + dedupes multi-status pages and sums totals', async () => {
    const mock = new MockFetch();
    mock.onAll(
      perStatusRoute({
        publish: { body: [{ id: 1 }, { id: 2 }], total: 2, totalPages: 1 },
        draft: { body: [{ id: 2 }, { id: 3 }], total: 2, totalPages: 1 },
      }),
    );
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.listProducts(STORE(), { page: 1, pageSize: 100 });
    expect(out.products.map((p) => (p as unknown as Record<string, unknown>).id)).toEqual([
      1, 2, 3,
    ]);
    expect(out.total).toBe(4);
    expect(out.hasMore).toBe(false);
  });

  it('prefers X-WP-TotalPages for hasMore (any status with more pages)', async () => {
    const mock = new MockFetch();
    mock.onAll(
      perStatusRoute({
        publish: { body: [{ id: 1 }], total: 1, totalPages: 1 },
        draft: { body: [{ id: 2 }], total: 250, totalPages: 3 },
      }),
    );
    const provider = new WooCommerceProvider(mock.fetch);
    const page1 = await provider.listProducts(STORE(), { page: 1, pageSize: 100 });
    expect(page1.hasMore).toBe(true);
    expect(page1.total).toBe(251);
    const page3 = await provider.listProducts(STORE(), { page: 3, pageSize: 100 });
    expect(page3.hasMore).toBe(false);
  });

  it('falls back to the length heuristic when the headers are absent', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, [{ id: 1 }, { id: 2 }]));
    const provider = new WooCommerceProvider(mock.fetch);
    const short = await provider.listProducts(STORE(), { page: 1, pageSize: 100 });
    expect(short.hasMore).toBe(false);
    expect(short.total).toBeUndefined();
  });

  it('length heuristic: a full page on ANY status means hasMore', async () => {
    const mock = new MockFetch();
    const full = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i }));
    mock.onAll((url) => {
      const status = new URL(url).searchParams.get('status');
      return jsonResponse(200, status === 'draft' ? full : [{ id: 1 }]);
    });
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.listProducts(STORE(), { page: 1, pageSize: 10 });
    expect(out.hasMore).toBe(true);
    expect(out.total).toBeUndefined();
  });

  it('sends modified_after + orderby=modified&order=asc for incremental import', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(0, 0, []));
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.listProducts(STORE(), {
      page: 1,
      pageSize: 10,
      modifiedAfter: new Date('2026-11-20T00:00:00.000Z'),
    });
    expect(mock.calls).toHaveLength(2);
    for (const { url } of mock.calls) {
      expect(url).toContain('modified_after=2026-11-20T00%3A00%3A00.000Z');
      expect(url).toContain('orderby=modified');
      expect(url).toContain('order=asc');
    }
  });

  it('sends include[] for selection import and search for the catalog filter', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(2, 1, [{ id: 5 }, { id: 9 }]));
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.listProducts(STORE(), {
      page: 1,
      pageSize: 100,
      include: ['5', '9'],
      search: 'panjabi',
    });
    expect(mock.calls).toHaveLength(2);
    for (const { url } of mock.calls) {
      expect(url).toContain('include%5B%5D=5');
      expect(url).toContain('include%5B%5D=9');
      expect(url).toContain('search=panjabi');
    }
  });

  it('honours an explicit status list', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(0, 0, []));
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.listProducts(STORE(), { page: 1, pageSize: 10, status: ['publish'] });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toContain('status=publish');
    expect(mock.calls[0]!.url).not.toContain('draft');
  });

  it('requests each of the processor statuses separately (4-status selection import)', async () => {
    const mock = new MockFetch();
    mock.onAll(
      perStatusRoute({
        publish: { body: [{ id: 5 }], total: 1, totalPages: 1 },
        draft: { body: [], total: 0, totalPages: 0 },
        private: { body: [{ id: 9 }], total: 1, totalPages: 1 },
        pending: { body: [], total: 0, totalPages: 0 },
      }),
    );
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.listProducts(STORE(), {
      page: 1,
      pageSize: 100,
      include: ['5', '9'],
      status: ['publish', 'draft', 'private', 'pending'],
    });
    expect(mock.calls).toHaveLength(4);
    expect(mock.calls.map((c) => new URL(c.url).searchParams.get('status'))).toEqual([
      'publish',
      'draft',
      'private',
      'pending',
    ]);
    for (const { url } of mock.calls) {
      expect(url).toContain('include%5B%5D=5');
      expect(url).toContain('include%5B%5D=9');
      expect(url).not.toContain('%2C');
    }
    expect(out.products.map((p) => (p as unknown as Record<string, unknown>).id)).toEqual([
      5, 9,
    ]);
    expect(out.total).toBe(2);
    expect(out.hasMore).toBe(false);
  });
});

describe('WooCommerce listVariations / fetchProduct (§6.3)', () => {
  it('lists variations from the child endpoint', async () => {
    const mock = new MockFetch();
    mock.onAll((url) => {
      expect(url).toContain('/wp-json/wc/v3/products/42/variations?');
      return jsonResponse(200, [{ id: 201, sku: 'V-1' }], {
        'x-wp-totalpages': '1',
      });
    });
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.listVariations(STORE(), { providerId: '42' }, { page: 1, pageSize: 100 });
    expect(out.variations).toHaveLength(1);
    expect(out.hasMore).toBe(false);
  });

  it('fetches one product by id', async () => {
    const mock = new MockFetch();
    mock.onAll((url) => {
      expect(url).toContain('/wp-json/wc/v3/products/7');
      return jsonResponse(200, { id: 7, name: 'Solo' });
    });
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.fetchProduct(STORE(), { providerId: '7' });
    expect((out as Record<string, unknown>).name).toBe('Solo');
  });

  it('maps a fetchProduct 404 to REMOTE_NOT_FOUND (R10 remote-delete detection)', async () => {
    const mock = new MockFetch();
    mock.onAll(() =>
      jsonResponse(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' }),
    );
    const provider = new WooCommerceProvider(mock.fetch);
    const err = await provider
      .fetchProduct(STORE(), { providerId: '999' })
      .then(
        () => null,
        (e) => e,
      );
    expect(err).not.toBeNull();
    expect(err.category).toBe(ProviderErrorCategory.REMOTE_NOT_FOUND);
  });
});

describe('WooCommerce woo() timeout + snapshotsFromProductBody', () => {
  it('passes an AbortSignal to fetch (30s timeout, §11)', async () => {
    const mock = new MockFetch();
    mock.onAll(() => jsonResponse(200, { id: 1 }));
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.fetchProduct(STORE(), { providerId: '1' });
    const signal = mock.calls[0]!.init?.signal as AbortSignal | undefined;
    expect(signal).toBeDefined();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
  });

  it('derives baseline snapshots from an already-fetched body without a GET', async () => {
    const mock = new MockFetch();
    const provider = new WooCommerceProvider(mock.fetch);
    const snaps = provider.snapshotsFromProductBody(
      { id: 1, name: 'Blue Panjabi', sku: 'BP-001', regular_price: '1200' } as any,
      ['name', 'sku', 'price'],
    );
    expect(snaps.name).toBeDefined();
    expect(snaps.sku).toBeDefined();
    expect(snaps.price).toBeDefined();
    expect(mock.calls).toHaveLength(0);
  });
});
