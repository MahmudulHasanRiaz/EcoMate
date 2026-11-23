import { resolveWebhookCallbackBase, StoresController } from './stores.controller';

describe('StoresController.ensureWebhooks (manual endpoint)', () => {
  it('ensures the webhook secret first (generated + stored when the store has none)', async () => {
    const ensureStoreWebhooks = jest.fn().mockResolvedValue({ ok: true, topics: [] });
    const controller = new StoresController(
      {
        detail: jest.fn().mockResolvedValue({ id: 'store-1' }),
        ensureStoreWebhooks,
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await controller.ensureWebhooks('store-1');
    expect(ensureStoreWebhooks).toHaveBeenCalledWith('store-1', { ensureSecret: true });
  });
});

describe('resolveWebhookCallbackBase', () => {
  it('accepts an https URL and strips trailing slashes', () => {
    expect(
      resolveWebhookCallbackBase({
        PUBLIC_API_BASE_URL: 'https://api.example.test///',
      }),
    ).toBe('https://api.example.test');
  });

  it('rejects missing/http/relative bases with 400', () => {
    for (const env of [{}, { PUBLIC_API_BASE_URL: '' }, { PUBLIC_API_BASE_URL: 'http://x.test' }, { PUBLIC_API_BASE_URL: '/api' }]) {
      const err = (() => {
        try {
          resolveWebhookCallbackBase(env);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(err?.constructor?.name).toBe('BadRequestException');
    }
  });
});
