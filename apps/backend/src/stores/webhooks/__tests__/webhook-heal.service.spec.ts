/**
 * Webhook heal-on-signature-failure (J-01, G-07) — Phase 9 webhook lifecycle.
 *
 * Proves: the first failure heals (secret rotation + force-recreate
 * ensure), the second call within the 10-minute cooldown is a no-op, a
 * different reason heals independently, and a heal failure never throws
 * into the caller (fire-and-forget contract).
 */
import { WebhookHealService } from '../webhook-heal.service';

function buildStores() {
  return {
    rotateWebhookSecret: jest.fn().mockResolvedValue(true),
    ensureStoreWebhooksBestEffort: jest.fn().mockResolvedValue({
      status: 'ok',
      topics: ['order.created'],
      created: [],
      recreated: ['order.created'],
      deleted: 1,
      at: new Date().toISOString(),
    }),
  };
}

/** Minimal in-memory CacheService stand-in (getGlobal/setGlobal). */
function buildCache() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    store,
    getGlobal: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    }),
    setGlobal: jest.fn(async (key: string, value: string, ttlMs?: number) => {
      store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? 0) });
    }),
  };
}

describe('WebhookHealService.maybeHealOnSignatureFailure', () => {
  it('heals on the first failure: rotates the secret + force-recreates', async () => {
    const stores: any = buildStores();
    const heal = new WebhookHealService(stores, undefined, undefined);
    await heal.maybeHealOnSignatureFailure('store-1', 'bad-signature');
    expect(stores.rotateWebhookSecret).toHaveBeenCalledWith('store-1');
    expect(stores.ensureStoreWebhooksBestEffort).toHaveBeenCalledWith('store-1', {
      forceRecreate: true,
      ensureSecret: true,
    });
  });

  it('cooldown: the second call within 10 minutes is a no-op', async () => {
    const stores: any = buildStores();
    const cache: any = buildCache();
    const heal = new WebhookHealService(stores, cache, undefined);
    await heal.maybeHealOnSignatureFailure('store-1', 'bad-signature');
    await heal.maybeHealOnSignatureFailure('store-1', 'bad-signature');
    await heal.maybeHealOnSignatureFailure('store-1', 'bad-signature');
    expect(stores.rotateWebhookSecret).toHaveBeenCalledTimes(1);
    expect(stores.ensureStoreWebhooksBestEffort).toHaveBeenCalledTimes(1);
    // The cooldown key is the contracted Redis key.
    expect(cache.setGlobal).toHaveBeenCalledWith(
      'webhook:heal:cooldown:store-1:bad-signature',
      '1',
      10 * 60_000,
    );
  });

  it('cooldown works with no CacheService (in-memory fallback)', async () => {
    const stores: any = buildStores();
    const heal = new WebhookHealService(stores, undefined, undefined);
    await heal.maybeHealOnSignatureFailure('store-1', 'no-secret-configured');
    await heal.maybeHealOnSignatureFailure('store-1', 'no-secret-configured');
    expect(stores.rotateWebhookSecret).toHaveBeenCalledTimes(1);
  });

  it('a different reason heals independently (per-(store, reason) cooldown)', async () => {
    const stores: any = buildStores();
    const heal = new WebhookHealService(stores, undefined, undefined);
    await heal.maybeHealOnSignatureFailure('store-1', 'bad-signature');
    await heal.maybeHealOnSignatureFailure('store-1', 'missing-signature');
    expect(stores.rotateWebhookSecret).toHaveBeenCalledTimes(2);
  });

  it('a different store heals independently', async () => {
    const stores: any = buildStores();
    const heal = new WebhookHealService(stores, undefined, undefined);
    await heal.maybeHealOnSignatureFailure('store-1', 'bad-signature');
    await heal.maybeHealOnSignatureFailure('store-2', 'bad-signature');
    expect(stores.rotateWebhookSecret).toHaveBeenCalledTimes(2);
  });

  it('never throws: rotation + ensure failures resolve quietly', async () => {
    const stores: any = buildStores();
    stores.rotateWebhookSecret.mockRejectedValue(new Error('db down'));
    const heal = new WebhookHealService(stores, undefined, undefined);
    await expect(
      heal.maybeHealOnSignatureFailure('store-1', 'bad-signature'),
    ).resolves.toBeUndefined();
  });

  it('never throws: a failed ensure outcome resolves quietly', async () => {
    const stores: any = buildStores();
    stores.ensureStoreWebhooksBestEffort.mockResolvedValue({
      status: 'failed',
      topics: [],
      created: [],
      recreated: [],
      deleted: 0,
      error: 'provider down',
      at: new Date().toISOString(),
    });
    const heal = new WebhookHealService(stores, undefined, undefined);
    await expect(
      heal.maybeHealOnSignatureFailure('store-1', 'bad-signature'),
    ).resolves.toBeUndefined();
  });
});
