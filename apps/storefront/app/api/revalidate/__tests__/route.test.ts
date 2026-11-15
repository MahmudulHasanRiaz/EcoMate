import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { POST } from '../route';

const mockedRevalidateTag = vi.mocked(revalidateTag);
const SECRET = 'test-revalidation-secret';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000002';

function makeRequest(opts: {
  secret?: string | null;
  body?: unknown;
  url?: string;
} = {}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.secret) headers.set('x-revalidation-secret', opts.secret);
  return new Request(opts.url ?? 'http://localhost/api/revalidate', {
    method: 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

describe('POST /api/revalidate (P4, tenant-scoped)', () => {
  beforeEach(() => {
    mockedRevalidateTag.mockReset();
  });

  afterEach(() => {
    delete process.env.REVALIDATION_SECRET;
    vi.restoreAllMocks();
  });

  it('is disabled (401, no revalidation) when REVALIDATION_SECRET is unset', async () => {
    delete process.env.REVALIDATION_SECRET;
    const res = await POST(
      makeRequest({
        secret: SECRET,
        body: { tenantId: TENANT_ID, tags: ['products'] },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret with 401 and does not revalidate', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({
        secret: 'wrong-secret-value',
        body: { tenantId: TENANT_ID, tags: ['products'] },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('rejects a missing secret with 401', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({ body: { tenantId: TENANT_ID, tags: ['products'] } }),
    );
    expect(res.status).toBe(401);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('requires a valid tenantId', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    for (const body of [
      { tags: ['products'] },
      { tenantId: 'not-a-uuid', tags: ['products'] },
    ]) {
      const res = await POST(makeRequest({ secret: SECRET, body }));
      expect(res.status).toBe(400);
    }
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('revalidates tenant-scoped tags with immediate expiry', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({
        secret: SECRET,
        body: { tenantId: TENANT_ID, tags: ['products', 'config'] },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      revalidated: true,
      tenantId: TENANT_ID,
      tags: [`t:${TENANT_ID}:products`, `t:${TENANT_ID}:config`],
    });
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(2);
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      `t:${TENANT_ID}:products`,
      { expire: 0 },
    );
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      `t:${TENANT_ID}:config`,
      { expire: 0 },
    );
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('accepts a Bearer authorization header and tenantId query params', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const req = new Request(
      `http://localhost/api/revalidate?tag=config&tenantId=${TENANT_ID}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}` },
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      `t:${TENANT_ID}:config`,
      { expire: 0 },
    );
  });

  it('accepts an already-scoped tag for the same tenant', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({
        secret: SECRET,
        body: { tenantId: TENANT_ID, tags: [`t:${TENANT_ID}:products`] },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      `t:${TENANT_ID}:products`,
      { expire: 0 },
    );
  });

  it('refuses to revalidate another tenant scoped tag', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({
        secret: SECRET,
        body: { tenantId: TENANT_ID, tags: [`t:${OTHER_TENANT}:products`] },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('returns 400 and revalidates nothing for unknown tags only', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({
        secret: SECRET,
        body: { tenantId: TENANT_ID, tags: ['orders', 'secrets'] },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockedRevalidateTag).not.toHaveBeenCalled();
  });

  it('ignores unknown tags when at least one valid tag is present', async () => {
    process.env.REVALIDATION_SECRET = SECRET;
    const res = await POST(
      makeRequest({
        secret: SECRET,
        body: { tenantId: TENANT_ID, tags: ['products', 'bogus'] },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      `t:${TENANT_ID}:products`,
      { expire: 0 },
    );
  });
});
