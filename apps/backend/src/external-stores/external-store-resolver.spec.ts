import { ExternalStoreResolver } from './external-store-resolver.service';

/**
 * ExternalStoreResolver — Phase 9 §3.3. The platform endpoint is
 * mocked here (unit scope); the live contract against the real
 * platform-api is covered by the builder-a live probes
 * (phase9-verify/builder-a/).
 */
describe('ExternalStoreResolver', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const STORE = '22222222-2222-4222-8222-222222222222';

  function build() {
    const store = new Map<string, unknown>();
    const cache = {
      getGlobal: jest.fn(async (key: string) => store.get(key)),
      setGlobal: jest.fn(async (key: string, data: unknown) => {
        store.set(key, data);
      }),
      deleteGlobal: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    };
    const platform = {
      resolveByStoreId: jest.fn(async (_id: string) => null as any),
      resolveByProviderDomain: jest.fn(async (_p: string, _d: string) => null as any),
    };
    const resolver = new ExternalStoreResolver(cache as any, platform as any);
    return { store, cache, platform, resolver };
  }

  it('resolves from the platform on a cache miss and caches the result', async () => {
    const { platform, resolver, cache } = build();
    platform.resolveByStoreId.mockResolvedValueOnce({ tenantId: TENANT, status: 'ACTIVE' });
    const first = await resolver.resolveStore(STORE);
    expect(first).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
    expect(platform.resolveByStoreId).toHaveBeenCalledTimes(1);
    const second = await resolver.resolveStore(STORE);
    expect(second).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
    expect(platform.resolveByStoreId).toHaveBeenCalledTimes(1);
    expect(cache.setGlobal).toHaveBeenCalledWith(
      `extstore:${STORE}`,
      { tenantId: TENANT, status: 'ACTIVE' },
      expect.any(Number),
    );
  });

  it('caches a platform 404 (negative) and returns null without re-calling', async () => {
    const { platform, resolver } = build();
    platform.resolveByStoreId.mockResolvedValue(null);
    expect(await resolver.resolveStore(STORE)).toBeNull();
    expect(await resolver.resolveStore(STORE)).toBeNull();
    expect(platform.resolveByStoreId).toHaveBeenCalledTimes(1);
  });

  it('fails closed (null) when the platform throws and the cache misses', async () => {
    const { platform, resolver } = build();
    platform.resolveByStoreId.mockRejectedValueOnce(new Error('platform down'));
    expect(await resolver.resolveStore(STORE)).toBeNull();
  });

  it('serves a cached ACTIVE entry even when the platform is down', async () => {
    const { platform, resolver } = build();
    platform.resolveByStoreId.mockResolvedValueOnce({ tenantId: TENANT, status: 'ACTIVE' });
    expect(await resolver.resolveStore(STORE)).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
    platform.resolveByStoreId.mockRejectedValueOnce(new Error('platform down'));
    expect(await resolver.resolveStore(STORE)).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
  });

  it.each(['DISCONNECTED', 'BLOCKED'])('does not resolve status %s', async (status) => {
    const { platform, resolver } = build();
    platform.resolveByStoreId.mockResolvedValueOnce({ tenantId: TENANT, status });
    expect(await resolver.resolveStore(STORE)).toBeNull();
  });

  it('resolves PENDING (connect in flight — the install landing needs it)', async () => {
    const { platform, resolver } = build();
    platform.resolveByStoreId.mockResolvedValueOnce({ tenantId: TENANT, status: 'PENDING' });
    expect(await resolver.resolveStore(STORE)).toEqual({ tenantId: TENANT, status: 'PENDING' });
  });

  it('resolves by provider+domain through the domain cache key', async () => {
    const { platform, resolver, cache } = build();
    platform.resolveByProviderDomain.mockResolvedValueOnce({ tenantId: TENANT, status: 'ACTIVE' });
    const res = await resolver.resolveDomain('SHOPIFY', '  Shop.MyShopify.com ');
    expect(res).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
    expect(platform.resolveByProviderDomain).toHaveBeenCalledWith('SHOPIFY', 'shop.myshopify.com');
    expect(cache.setGlobal).toHaveBeenCalledWith(
      'extstore:domain:SHOPIFY:shop.myshopify.com',
      { tenantId: TENANT, status: 'ACTIVE' },
      expect.any(Number),
    );
    expect(await resolver.resolveDomain('SHOPIFY', 'shop.myshopify.com')).toEqual({
      tenantId: TENANT,
      status: 'ACTIVE',
    });
    expect(platform.resolveByProviderDomain).toHaveBeenCalledTimes(1);
  });

  it('cacheBinding warms both keys; invalidate drops both', async () => {
    const { resolver, cache, platform } = build();
    await resolver.cacheBinding(STORE, TENANT, { provider: 'SHOPIFY', domain: 'shop.myshopify.com' });
    expect(cache.setGlobal).toHaveBeenCalledWith(
      `extstore:${STORE}`,
      { tenantId: TENANT, status: 'ACTIVE' },
      expect.any(Number),
    );
    expect(cache.setGlobal).toHaveBeenCalledWith(
      'extstore:domain:SHOPIFY:shop.myshopify.com',
      { tenantId: TENANT, status: 'ACTIVE' },
      expect.any(Number),
    );
    expect(await resolver.resolveStore(STORE)).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
    expect(platform.resolveByStoreId).not.toHaveBeenCalled();
    await resolver.invalidate(STORE, { provider: 'SHOPIFY', domain: 'shop.myshopify.com' });
    expect(cache.deleteGlobal).toHaveBeenCalledWith(`extstore:${STORE}`);
    expect(cache.deleteGlobal).toHaveBeenCalledWith('extstore:domain:SHOPIFY:shop.myshopify.com');
  });

  it('returns null for empty inputs without touching the platform', async () => {
    const { resolver, platform } = build();
    expect(await resolver.resolveStore('')).toBeNull();
    expect(await resolver.resolveDomain('SHOPIFY', '   ')).toBeNull();
    expect(platform.resolveByStoreId).not.toHaveBeenCalled();
    expect(platform.resolveByProviderDomain).not.toHaveBeenCalled();
  });
});
