import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { TenantDomainsService } from './tenant-domains.service';

describe('TenantDomainsService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  const service = new TenantDomainsService();

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PLATFORM_API_URL = 'http://127.0.0.1:4100/api';
    process.env.INTERNAL_SERVICE_SECRET = 'test-service-token';
    jest.clearAllMocks();
    global.fetch = fetchMock as any;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  function okJson(body: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => body,
      headers: new Headers(),
      body: null,
    };
  }

  function errJson(status: number, body: unknown) {
    return {
      ok: false,
      status,
      json: async () => body,
      headers: new Headers(),
      body: null,
    };
  }

  it('throws 503 when the platform config is missing', async () => {
    delete process.env.PLATFORM_API_URL;
    await expect(service.list('tenant-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists domains for the tenant id with the service token', async () => {
    fetchMock.mockResolvedValue(okJson([{ id: 'd1', host: 'a.example.com' }]));
    const result = await service.list('tenant-1');

    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/domains',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-platform-service-token': 'test-service-token',
        }),
      }),
    );
  });

  it('adds a domain with a JSON body and the tenant-scoped path', async () => {
    fetchMock.mockResolvedValue(
      okJson({ domain: { id: 'd1' }, dns: null }),
    );
    await service.add('tenant-1', 'shop.example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/domains',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ host: 'shop.example.com' }),
      }),
    );
  });

  it('rechecks and removes with the domain id in the path', async () => {
    fetchMock.mockResolvedValue(okJson({ verified: true }));
    await service.recheck('tenant-1', 'domain-9');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/domains/domain-9/recheck',
      expect.objectContaining({ method: 'POST' }),
    );

    fetchMock.mockResolvedValue(okJson({ deleted: true }));
    await service.remove('tenant-1', 'domain-9');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/domains/domain-9',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('passes platform errors through with status and message intact', async () => {
    fetchMock.mockResolvedValue(
      errJson(403, { message: 'The current plan does not include custom domains' }),
    );
    const forbidden = service.add('tenant-1', 'shop.example.com');
    await expect(forbidden).rejects.toBeInstanceOf(HttpException);
    await expect(forbidden).rejects.toMatchObject({
      status: 403,
      message: 'The current plan does not include custom domains',
    });

    fetchMock.mockResolvedValue(
      errJson(409, { message: 'Domain is already assigned' }),
    );
    await expect(service.add('tenant-1', 'shop.example.com')).rejects.toMatchObject({
      status: 409,
      message: 'Domain is already assigned',
    });
  });
});
