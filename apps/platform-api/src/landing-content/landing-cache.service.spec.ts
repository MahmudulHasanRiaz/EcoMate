import { LandingCacheService } from './landing-cache.service';

describe('LandingCacheService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function mockFetch(response: {
    ok: boolean;
    status: number;
    json?: () => Promise<unknown>;
  }) {
    const fetchMock = jest.fn().mockResolvedValue(response);
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as any);
    return fetchMock;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts to the landing revalidate route with the shared secret', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    process.env.LANDING_INTERNAL_URL = 'http://landing:3002';
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        revalidated: ['landing-content', 'branding'],
      }),
    });
    const service = new LandingCacheService();
    await expect(service.purge()).resolves.toEqual({
      revalidated: ['landing-content', 'branding'],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://landing:3002/api/revalidate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-internal-secret': 'secret-1',
        }),
      }),
    );
  });

  it('defaults the landing URL to localhost:3002', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    delete process.env.LANDING_INTERNAL_URL;
    const fetchMock = mockFetch({ ok: true, status: 200 });
    const service = new LandingCacheService();
    await service.purge();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/api/revalidate',
      expect.anything(),
    );
  });

  it('fails closed with 503 when the secret is unconfigured', async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const fetchMock = mockFetch({ ok: true, status: 200 });
    const service = new LandingCacheService();
    await expect(service.purge()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a landing rejection to 503', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    mockFetch({ ok: false, status: 401 });
    const service = new LandingCacheService();
    await expect(service.purge()).rejects.toMatchObject({ status: 503 });
  });

  it('maps an unreachable landing to 503', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'secret-1';
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('connect ECONNREFUSED'));
    const service = new LandingCacheService();
    await expect(service.purge()).rejects.toMatchObject({ status: 503 });
  });
});
