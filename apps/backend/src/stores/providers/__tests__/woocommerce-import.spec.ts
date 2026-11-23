/**
 * WooCommerce product-import provider methods (§6.2–6.3).
 *
 * Proves listProducts / listVariations / fetchProduct against a stubbed
 * Woo REST API: query params (page/per_page cap, default status,
 * modified_after + order, include[]), the header-aware wooPage() helper
 * (X-WP-Total / X-WP-TotalPages), the 30s AbortSignal timeout on woo(),
 * and snapshotsFromProductBody (no extra GET for baseline seeding).
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
  it('sends page/per_page (capped at 100) + default status publish,draft', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(1, 1, [{ id: 1, name: 'A' }]));
    const provider = new WooCommerceProvider(mock.fetch);
    const out = await provider.listProducts(STORE(), { page: 2, pageSize: 250 });
    const url = mock.calls[0]!.url;
    expect(url).toContain('/wp-json/wc/v3/products?');
    expect(url).toContain('page=2');
    expect(url).toContain('per_page=100');
    expect(url).toContain('status=publish%2Cdraft');
    expect(out.products).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it('prefers X-WP-TotalPages for hasMore', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(250, 3, [{ id: 1 }]));
    const provider = new WooCommerceProvider(mock.fetch);
    const page1 = await provider.listProducts(STORE(), { page: 1, pageSize: 100 });
    expect(page1.hasMore).toBe(true);
    expect(page1.total).toBe(250);
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

  it('sends modified_after + orderby=modified&order=asc for incremental import', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(0, 0, []));
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.listProducts(STORE(), {
      page: 1,
      pageSize: 10,
      modifiedAfter: new Date('2026-11-20T00:00:00.000Z'),
    });
    const url = mock.calls[0]!.url;
    expect(url).toContain('modified_after=2026-11-20T00%3A00%3A00.000Z');
    expect(url).toContain('orderby=modified');
    expect(url).toContain('order=asc');
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
    const url = mock.calls[0]!.url;
    expect(url).toContain('include%5B%5D=5');
    expect(url).toContain('include%5B%5D=9');
    expect(url).toContain('search=panjabi');
  });

  it('honours an explicit status list', async () => {
    const mock = new MockFetch();
    mock.onAll(productsRoute(0, 0, []));
    const provider = new WooCommerceProvider(mock.fetch);
    await provider.listProducts(STORE(), { page: 1, pageSize: 10, status: ['publish'] });
    expect(mock.calls[0]!.url).toContain('status=publish');
    expect(mock.calls[0]!.url).not.toContain('draft');
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
