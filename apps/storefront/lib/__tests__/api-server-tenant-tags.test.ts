import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { headers } from 'next/headers';
import { serverFetch } from '../api-server';

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

const headersMock = vi.mocked(headers);

function okResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '{"ok":true}',
  } as Response;
}

describe('serverFetch tenant-scoped Data Cache tags', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefixes tags with the tenant id injected by the proxy', async () => {
    headersMock.mockResolvedValue(
      new Headers({
        host: 'acme.ecomate.bd',
        'x-tenant-id': 'tenant-1111',
        'x-tenant-slug': 'acme',
      }) as never,
    );

    await serverFetch('/products', { tags: ['products'] });
    await serverFetch('/system-settings/storefront', {
      next: { revalidate: 60, tags: ['config'] },
    } as any);

    expect(fetchMock.mock.calls[0][1].next.tags).toEqual([
      't:tenant-1111:products',
    ]);
    expect(fetchMock.mock.calls[1][1].next.tags).toEqual([
      't:tenant-1111:config',
    ]);
  });

  it('falls back to the tenant slug when the id is unavailable', async () => {
    headersMock.mockResolvedValue(
      new Headers({ host: 'acme.ecomate.bd', 'x-tenant-slug': 'acme' }) as never,
    );

    await serverFetch('/products', { tags: ['products'] });
    expect(fetchMock.mock.calls[0][1].next.tags).toEqual([
      't:acme:products',
    ]);
  });

  it('uses the unresolved namespace outside a request scope', async () => {
    headersMock.mockRejectedValue(new Error('outside a request scope'));

    await serverFetch('/products', { tags: ['products'] });
    expect(fetchMock.mock.calls[0][1].next.tags).toEqual([
      't:unresolved:products',
    ]);
  });

  it('does not add tags when the caller asked for none', async () => {
    headersMock.mockResolvedValue(
      new Headers({ 'x-tenant-id': 'tenant-1111' }) as never,
    );

    await serverFetch('/products');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('next');
  });
});
