/**
 * Webhook lifecycle — StoresService (Phase 9, G-01/G-02/G-03).
 *
 * Proves (mocked provider + mock Prisma — no network, no DB):
 * (a) connect auto-creates webhooks with a server-generated secret
 *     (persisted encrypted in the secrets blob, sent to the provider);
 * (d) an ensure failure never fails connect (logged + issue row +
 *     outcome surfaced in the store detail settings);
 * - secret preservation across reconnect/rotation (a rotation that omits
 *   webhookSecret carries the stored one forward; a Woo store with none
 *   gets one generated; a changed secret force-recreates the hooks);
 * - testConnection ensures on an authenticated probe against stored
 *   credentials only (override-credential probes + failed probes skip).
 */
import { StoresService, WEBHOOK_ENSURE_FAILED_CODE } from './stores.service';

const BASE = 'https://api.example.test';

const encryption: any = {
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((s: string) => String(s).replace(/^enc:/, '')),
};

function buildPrisma(storeRow: any) {
  const credRows: any[] = [];
  const store = { ...storeRow };
  const prisma: any = {
    credRows,
    store: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({ ...store })),
      create: jest.fn(async ({ data }: any) => {
        Object.assign(store, data);
        return { ...store };
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(store, data);
        return { ...store };
      }),
    },
    storeCredential: {
      findFirst: jest.fn(async () => credRows[credRows.length - 1] ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cred-${credRows.length}`, rotatedAt: new Date(), ...data };
        credRows.push(row);
        return row;
      }),
    },
    storeHealthCheck: { create: jest.fn(async () => ({})) },
  };
  return prisma;
}

function buildService(prisma: any, provider: any, syncRuns?: any) {
  const registry: any = { providerFor: jest.fn(() => provider) };
  const svc = new StoresService(
    prisma as any,
    encryption as any,
    registry as any,
    undefined,
    undefined,
    undefined,
    syncRuns as any,
  );
  return { svc, registry };
}

function mockProvider() {
  return {
    testConnection: jest.fn().mockResolvedValue({
      reachable: true,
      authenticated: true,
      permissionsOk: true,
      capabilities: { products: true },
    }),
    ensureWebhooks: jest.fn().mockResolvedValue({
      ok: true,
      topics: ['order.created', 'order.updated', 'order.deleted', 'product.updated'],
      created: ['order.created', 'order.updated', 'order.deleted', 'product.updated'],
      recreated: [],
      deleted: 0,
      skipped: [],
    }),
  };
}

function decryptRow(row: any): Record<string, unknown> {
  return JSON.parse(String(row.credentialsEnc).replace(/^enc:/, ''));
}

describe('webhook lifecycle: StoresService', () => {
  const OLD_BASE = process.env.PUBLIC_API_BASE_URL;
  beforeEach(() => {
    process.env.PUBLIC_API_BASE_URL = BASE;
  });
  afterEach(() => {
    if (OLD_BASE === undefined) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = OLD_BASE;
    jest.clearAllMocks();
  });

  describe('connect auto-creates webhooks with secret (a)', () => {
    it('generates + persists a webhook secret and ensures with it', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'PENDING', settings: null });
      const provider = mockProvider();
      const syncRuns: any = { upsertIssue: jest.fn(async () => ({})) };
      const { svc } = buildService(prisma, provider, syncRuns);
      const out = (await svc.connect({
        kind: 'WOOCOMMERCE',
        name: 'Woo',
        domain: 'shop.example.test',
        providerStoreId: 'shop-1',
        credentials: {
          baseUrl: 'https://woo.example.test',
          consumerKey: 'ck_x',
          consumerSecret: 'cs_x',
        },
      } as any)) as any;

      // Two credential rows: the connect credentials, then the same blob
      // merged with the generated webhook secret (never a bare row).
      expect(prisma.credRows).toHaveLength(2);
      const merged = decryptRow(prisma.credRows[1]);
      expect(merged.consumerKey).toBe('ck_x');
      expect(merged.consumerSecret).toBe('cs_x');
      expect(merged.webhookSecret).toMatch(/^[0-9a-f]{64}$/);

      // The provider ensure ran with the secret in the store's secrets.
      expect(provider.ensureWebhooks).toHaveBeenCalledTimes(1);
      const [withSecrets, base] = provider.ensureWebhooks.mock.calls[0];
      expect(base).toBe(BASE);
      expect((withSecrets as any).secrets.webhookSecret).toBe(merged.webhookSecret);

      // Outcome surfaced inline (and persisted to settings by the helper).
      expect(out.settings.webhookEnsure.status).toBe('ok');
      expect(out.settings.webhookEnsure.topics).toContain('order.created');
      expect(syncRuns.upsertIssue).not.toHaveBeenCalled();
    });

    it('Shopify connect never generates a webhook secret (HMAC uses the app secret)', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'SHOPIFY', status: 'PENDING', settings: null });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      await svc.connect({
        kind: 'SHOPIFY',
        name: 'Shop',
        domain: 'shop.myshopify.com',
        providerStoreId: 'shop-1',
        credentials: { shop: 'shop.myshopify.com', clientId: 'cid', clientSecret: 'csec' },
      } as any);
      // Only the connect row — no secret-generation row.
      expect(prisma.credRows).toHaveLength(1);
      expect(decryptRow(prisma.credRows[0]).webhookSecret).toBeUndefined();
      expect(provider.ensureWebhooks).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensure failure never fails connect (d)', () => {
    it('provider ensure throws → connect still succeeds, issue row + failed outcome recorded', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'PENDING', settings: null });
      const provider = mockProvider();
      provider.ensureWebhooks.mockRejectedValue(new Error('woo down'));
      const syncRuns: any = { upsertIssue: jest.fn(async () => ({})) };
      const { svc } = buildService(prisma, provider, syncRuns);
      const out = (await svc.connect({
        kind: 'WOOCOMMERCE',
        name: 'Woo',
        domain: 'shop.example.test',
        providerStoreId: 'shop-1',
        credentials: { baseUrl: 'https://woo.example.test', consumerKey: 'ck_x', consumerSecret: 'cs_x' },
      } as any)) as any;

      expect(out.id).toBeDefined();
      expect(out.status).toBe('PENDING');
      expect(out.settings.webhookEnsure.status).toBe('failed');
      expect(out.settings.webhookEnsure.error).toMatch(/woo down/);
      expect(syncRuns.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({ code: WEBHOOK_ENSURE_FAILED_CODE, objectKey: 'webhook-ensure' }),
      );
    });

    it('unset PUBLIC_API_BASE_URL → connect succeeds, ensure fails loudly in the outcome', async () => {
      delete process.env.PUBLIC_API_BASE_URL;
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'PENDING', settings: null });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      const out = (await svc.connect({
        kind: 'WOOCOMMERCE',
        name: 'Woo',
        domain: 'shop.example.test',
        providerStoreId: 'shop-1',
        credentials: { baseUrl: 'https://woo.example.test', consumerKey: 'ck_x', consumerSecret: 'cs_x' },
      } as any)) as any;
      expect(out.id).toBeDefined();
      expect(out.settings.webhookEnsure.status).toBe('failed');
      expect(out.settings.webhookEnsure.error).toMatch(/PUBLIC_API_BASE_URL/);
      expect(provider.ensureWebhooks).not.toHaveBeenCalled();
    });
  });

  describe('secret preservation across reconnect/rotation', () => {
    function seedSecret(prisma: any, secrets: Record<string, unknown>) {
      prisma.credRows.push({
        id: 'cred-0',
        rotatedAt: new Date(),
        credentialsEnc: `enc:${JSON.stringify(secrets)}`,
      });
    }

    it('reconnect without a secret carries the stored secret forward (no re-ensure)', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'CONNECTED', settings: {} });
      seedSecret(prisma, { consumerKey: 'k1', consumerSecret: 's1', webhookSecret: 'wh_old_secret' });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      await svc.reconnect('store-1', { credentials: { consumerKey: 'k2', consumerSecret: 's2' } } as any);
      expect(prisma.credRows).toHaveLength(2);
      expect(decryptRow(prisma.credRows[1])).toEqual({
        consumerKey: 'k2',
        consumerSecret: 's2',
        webhookSecret: 'wh_old_secret',
      });
      // Secret unchanged → no force-recreate (the next probe ensures).
      expect(provider.ensureWebhooks).not.toHaveBeenCalled();
    });

    it('reconnect with no stored secret generates one + force-recreates the hooks', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'CONNECTED', settings: {} });
      seedSecret(prisma, { consumerKey: 'k1', consumerSecret: 's1' });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      await svc.reconnect('store-1', { credentials: { consumerKey: 'k2', consumerSecret: 's2' } } as any);
      const rotated = decryptRow(prisma.credRows[1]);
      expect(rotated.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(provider.ensureWebhooks).toHaveBeenCalledWith(
        expect.anything(),
        BASE,
        { forceRecreate: true },
      );
    });

    it('rotateCredentials preserves the secret and never echoes the payload', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'CONNECTED', settings: {} });
      seedSecret(prisma, { consumerKey: 'k1', webhookSecret: 'wh_old_secret' });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      const res = (await svc.rotateCredentials('store-1', {
        credentials: { consumerKey: 'k2' },
      } as any)) as any;
      expect(decryptRow(prisma.credRows[1]).webhookSecret).toBe('wh_old_secret');
      expect(JSON.stringify(res)).not.toContain('k2');
      expect(JSON.stringify(res)).not.toContain('wh_old_secret');
    });
  });

  describe('testConnection ensures webhooks', () => {
    it('authenticated probe against stored credentials ensures (no credential row written)', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'PENDING', settings: {} });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      const res = await svc.testConnection('store-1', undefined);
      expect((res as any).authenticated).toBe(true);
      expect(provider.ensureWebhooks).toHaveBeenCalledTimes(1);
      // A probe never writes a credential row (no secret generation here).
      expect(prisma.storeCredential.create).not.toHaveBeenCalled();
    });

    it('probe with override credentials skips the ensure (no side effects)', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'PENDING', settings: {} });
      const provider = mockProvider();
      const { svc } = buildService(prisma, provider);
      await svc.testConnection('store-1', {
        credentials: { baseUrl: 'https://other.example.test', consumerKey: 'k', consumerSecret: 's' },
      } as any);
      expect(provider.ensureWebhooks).not.toHaveBeenCalled();
    });

    it('failed probe skips the ensure', async () => {
      const prisma = buildPrisma({ id: 'store-1', kind: 'WOOCOMMERCE', status: 'PENDING', settings: {} });
      const provider = mockProvider();
      provider.testConnection.mockResolvedValue({
        reachable: false,
        authenticated: false,
        permissionsOk: false,
        capabilities: {},
      });
      const { svc } = buildService(prisma, provider);
      await svc.testConnection('store-1', undefined);
      expect(provider.ensureWebhooks).not.toHaveBeenCalled();
    });
  });
});
