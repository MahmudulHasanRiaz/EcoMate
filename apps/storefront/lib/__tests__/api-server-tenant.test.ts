import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { headers } from 'next/headers';
import { serverFetch } from '../api-server';

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

const headersMock = vi.mocked(headers);

function okResponse(body: unknown = { ok: true }) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('serverFetch tenant header forwarding', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockResolvedValue(okResponse());
    process.env.INTERNAL_SHARED_SECRET = 'internal-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INTERNAL_SHARED_SECRET;
  });

  it('forwards the incoming host and the internal secret to the backend', async () => {
    headersMock.mockResolvedValue(
      new Headers({ host: 'acme.ecomate.bd' }) as never,
    );

    await serverFetch('/products');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toMatchObject({
      'x-tenant-host': 'acme.ecomate.bd',
      'x-internal-secret': 'internal-secret',
      'Content-Type': 'application/json',
    });
  });

  it('prefers an explicit x-tenant-host set by the proxy', async () => {
    headersMock.mockResolvedValue(
      new Headers({
        host: 'backend:4000',
        'x-tenant-host': 'other.ecomate.bd',
      }) as never,
    );

    await serverFetch('/products');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['x-tenant-host']).toBe('other.ecomate.bd');
  });

  it('omits the host outside a request scope instead of crashing', async () => {
    headersMock.mockRejectedValue(new Error('outside a request scope'));

    await serverFetch('/products');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).not.toHaveProperty('x-tenant-host');
    expect(options.headers['x-internal-secret']).toBe('internal-secret');
  });

  it('merges caller headers without dropping the tenant headers', async () => {
    headersMock.mockResolvedValue(
      new Headers({ host: 'acme.ecomate.bd' }) as never,
    );

    await serverFetch('/products', {
      headers: { 'x-custom': '1' } as HeadersInit,
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toMatchObject({
      'x-custom': '1',
      'x-tenant-host': 'acme.ecomate.bd',
      'x-internal-secret': 'internal-secret',
    });
  });
});
