/**
 * Webhook lifecycle — provider ensureWebhooks (Phase 9, G-01/G-03/G-05/G-06,
 * jannat J-02).
 *
 * Proves, per provider (MockFetch — no network):
 * - duplicate healing: 2 hooks for one topic → exactly 1 after ensure;
 * - disabled/paused hooks are recreated (re-enabled via delete + recreate);
 * - mismatched delivery URLs are recreated; valid hooks are skipped
 *   (zero remote writes);
 * - the full list is paginated (a hook hiding past page 1 is found, not
 *   duplicated);
 * - Woo create payloads carry the agreed secret + status active, and a
 *   missing secret fails loudly instead of registering an unverifiable hook;
 * - hooks belonging to another integration are never touched.
 */
import { CustomBridgeProvider } from '../custom-bridge.provider';
import {
  SHOPIFY_WEBHOOK_TOPICS,
  ShopifyProvider,
} from '../shopify.provider';
import {
  WOOCOMMERCE_WEBHOOK_TOPICS,
  WooCommerceProvider,
} from '../woocommerce.provider';
import {
  MockFetch,
  buildStoreUnit,
  jsonResponse,
  mockShopifyTokenEndpoint,
} from './fixtures';
import { ReferenceBridge } from './reference-bridge';

const BASE = 'https://api.example.test';
const WOO_URL = `${BASE}/api/webhooks/stores/woocommerce/store-woo-1`;
const SHOPIFY_URL = `${BASE}/api/webhooks/stores/shopify/store-shopify-1`;

/** In-memory Woo webhook store behind a MockFetch handler (paginated). */
function wooWebhookServer(initial: any[] = []) {
  const hooks: any[] = [...initial];
  let nextId = 1000;
  const handler = (url: string, init?: any) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    if (u.pathname.endsWith('/webhooks') && method === 'GET') {
      const page = Number(u.searchParams.get('page') ?? '1');
      const perPage = Number(u.searchParams.get('per_page') ?? '100');
      const start = (page - 1) * perPage;
      const slice = hooks.slice(start, start + perPage);
      return jsonResponse(200, slice, {
        'X-WP-Total': String(hooks.length),
        'X-WP-TotalPages': String(Math.max(1, Math.ceil(hooks.length / perPage))),
      });
    }
    if (u.pathname.endsWith('/webhooks') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const created = { id: nextId++, status: 'active', ...body };
      hooks.push(created);
      return jsonResponse(201, created);
    }
    const del = u.pathname.match(/\/webhooks\/(\d+)$/);
    if (del && method === 'DELETE') {
      const id = Number(del[1]);
      const idx = hooks.findIndex((h) => h.id === id);
      if (idx === -1) return jsonResponse(404, { message: 'not found' });
      const [removed] = hooks.splice(idx, 1);
      return jsonResponse(200, removed);
    }
    return jsonResponse(404, { message: 'no mock' });
  };
  return { hooks, handler };
}

/** In-memory Shopify webhook store (since_id cursor pagination). */
function shopifyWebhookServer(initial: any[] = []) {
  const hooks: any[] = [...initial];
  let nextId = 1000;
  const handler = (url: string, init?: any) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    if (u.pathname.endsWith('/webhooks.json') && method === 'GET') {
      const limit = Number(u.searchParams.get('limit') ?? '250');
      const sinceId = u.searchParams.get('since_id');
      const after = sinceId === null ? hooks : hooks.filter((h) => h.id > Number(sinceId));
      return jsonResponse(200, { webhooks: after.slice(0, limit) });
    }
    if (u.pathname.endsWith('/webhooks.json') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const created = { id: nextId++, ...body.webhook };
      hooks.push(created);
      return jsonResponse(201, { webhook: created });
    }
    const del = u.pathname.match(/\/webhooks\/(\d+)\.json$/);
    if (del && method === 'DELETE') {
      const id = Number(del[1]);
      const idx = hooks.findIndex((h) => h.id === id);
      if (idx === -1) return jsonResponse(404, { errors: 'not found' });
      const [removed] = hooks.splice(idx, 1);
      return jsonResponse(200, removed);
    }
    return jsonResponse(404, { message: 'no mock' });
  };
  return { hooks, handler };
}

describe('webhook lifecycle: WooCommerce ensureWebhooks', () => {
  const STORE = () => buildStoreUnit('WOOCOMMERCE');

  it('creates all topics with secret + active status when none exist', async () => {
    const server = wooWebhookServer();
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.ok).toBe(true);
    expect(res.created).toEqual(WOOCOMMERCE_WEBHOOK_TOPICS);
    expect(res.recreated).toEqual([]);
    expect(res.deleted).toBe(0);
    expect(res.skipped).toEqual([]);
    expect(server.hooks).toHaveLength(WOOCOMMERCE_WEBHOOK_TOPICS.length);
    for (const h of server.hooks) {
      expect(h.delivery_url).toBe(WOO_URL);
      expect(h.secret).toBe('wh_woo_secret');
      expect(h.status).toBe('active');
    }
  });

  it('duplicate healing: 2 hooks for one topic → 1 after ensure', async () => {
    const server = wooWebhookServer([
      { id: 1, topic: 'order.created', delivery_url: WOO_URL, status: 'active' },
      { id: 2, topic: 'order.created', delivery_url: WOO_URL, status: 'active' },
    ]);
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    const created = server.hooks.filter((h) => h.topic === 'order.created');
    expect(created).toHaveLength(1);
    expect(created[0].delivery_url).toBe(WOO_URL);
    expect(created[0].status).toBe('active');
    expect(res.recreated).toContain('order.created');
    expect(res.deleted).toBe(2);
  });

  it('disabled hook is recreated (re-enabled via delete + recreate)', async () => {
    const server = wooWebhookServer([
      { id: 1, topic: 'order.created', delivery_url: WOO_URL, status: 'disabled' },
      { id: 2, topic: 'order.updated', delivery_url: WOO_URL, status: 'paused' },
    ]);
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.recreated).toEqual(expect.arrayContaining(['order.created', 'order.updated']));
    expect(res.deleted).toBe(2);
    for (const h of server.hooks.filter((x) => ['order.created', 'order.updated'].includes(x.topic))) {
      expect(h.status).toBe('active');
      expect(h.delivery_url).toBe(WOO_URL);
    }
  });

  it('mismatched URL (stale base) is recreated; valid hooks are skipped with zero writes', async () => {
    const stale = `https://old-api.example.test/api/webhooks/stores/woocommerce/store-woo-1`;
    const server = wooWebhookServer([
      { id: 1, topic: 'order.created', delivery_url: stale, status: 'active' },
      { id: 2, topic: 'order.updated', delivery_url: WOO_URL, status: 'active' },
    ]);
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.recreated).toContain('order.created');
    expect(res.skipped).toContain('order.updated');
    expect(res.created).toEqual(expect.arrayContaining(['order.deleted', 'product.updated']));
    const writes = mock.calls.filter((c) => c.init?.method === 'POST' || c.init?.method === 'DELETE');
    // order.created: 1 DELETE + 1 POST; order.deleted + product.updated: 1 POST each.
    expect(writes).toHaveLength(4);
    expect(server.hooks.find((h) => h.topic === 'order.updated')?.id).toBe(2);
  });

  it('pagination: a valid hook past page 1 is found, not duplicated', async () => {
    const fillers = Array.from({ length: 100 }, (_, i) => ({
      id: 10 + i,
      topic: 'customer.created',
      delivery_url: 'https://other.example.test/hook',
      status: 'active',
    }));
    const server = wooWebhookServer([
      ...fillers,
      { id: 500, topic: 'order.created', delivery_url: WOO_URL, status: 'active' },
    ]);
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.skipped).toContain('order.created');
    expect(server.hooks.filter((h) => h.topic === 'order.created')).toHaveLength(1);
    const gets = mock.calls.filter((c) => (c.init?.method ?? 'GET') === 'GET');
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it('hooks belonging to another integration are never touched', async () => {
    const server = wooWebhookServer([
      { id: 1, topic: 'order.created', delivery_url: 'https://zapier.example.test/hook/1', status: 'active' },
    ]);
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.created).toContain('order.created');
    expect(res.deleted).toBe(0);
    expect(server.hooks.find((h) => h.id === 1)).toBeDefined();
    expect(mock.calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(0);
  });

  it('missing webhook secret fails loudly instead of registering an unverifiable hook', async () => {
    const server = wooWebhookServer();
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const store = STORE();
    delete (store.secrets as any).webhookSecret;
    await expect(
      new WooCommerceProvider(mock.fetch).ensureWebhooks(store, BASE),
    ).rejects.toThrow(/no webhook secret/);
    expect(server.hooks).toHaveLength(0);
  });

  it('forceRecreate deletes every owned hook and recreates it', async () => {
    const server = wooWebhookServer([
      { id: 1, topic: 'order.created', delivery_url: WOO_URL, status: 'active' },
      { id: 2, topic: 'order.updated', delivery_url: WOO_URL, status: 'active' },
    ]);
    const mock = new MockFetch();
    mock.setFallback(server.handler);
    const res = await new WooCommerceProvider(mock.fetch).ensureWebhooks(STORE(), BASE, {
      forceRecreate: true,
    });
    expect(res.recreated).toEqual(expect.arrayContaining(['order.created', 'order.updated']));
    expect(res.deleted).toBe(2);
    expect(server.hooks.find((h) => h.id === 1)).toBeUndefined();
    expect(server.hooks.filter((h) => h.topic === 'order.created')).toHaveLength(1);
  });
});

describe('webhook lifecycle: Shopify ensureWebhooks', () => {
  const STORE = () => buildStoreUnit('SHOPIFY');

  function shopifyMock(server: ReturnType<typeof shopifyWebhookServer>) {
    const mock = new MockFetch();
    mockShopifyTokenEndpoint(mock);
    mock.setFallback(server.handler);
    return mock;
  }

  it('duplicate healing: 2 hooks for one topic → 1 after ensure', async () => {
    const server = shopifyWebhookServer([
      { id: 1, topic: 'orders/create', address: SHOPIFY_URL },
      { id: 2, topic: 'orders/create', address: SHOPIFY_URL },
    ]);
    const mock = shopifyMock(server);
    const res = await new ShopifyProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(server.hooks.filter((h) => h.topic === 'orders/create')).toHaveLength(1);
    expect(res.recreated).toContain('orders/create');
    expect(res.deleted).toBe(2);
  });

  it('mismatched address is recreated; valid hooks skipped', async () => {
    const stale = `https://old-api.example.test/api/webhooks/stores/shopify/store-shopify-1`;
    const server = shopifyWebhookServer([
      { id: 1, topic: 'orders/create', address: stale },
      { id: 2, topic: 'orders/updated', address: SHOPIFY_URL },
    ]);
    const mock = shopifyMock(server);
    const res = await new ShopifyProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.recreated).toContain('orders/create');
    expect(res.skipped).toContain('orders/updated');
    expect(server.hooks.find((h) => h.topic === 'orders/updated')?.id).toBe(2);
  });

  it('since_id pagination: a valid hook past the first 250 is found, not duplicated', async () => {
    const fillers = Array.from({ length: 250 }, (_, i) => ({
      id: 10 + i,
      topic: 'customers/create',
      address: 'https://other.example.test/hook',
    }));
    const server = shopifyWebhookServer([
      ...fillers,
      { id: 999, topic: 'orders/create', address: SHOPIFY_URL },
    ]);
    const mock = shopifyMock(server);
    const res = await new ShopifyProvider(mock.fetch).ensureWebhooks(STORE(), BASE);
    expect(res.skipped).toContain('orders/create');
    expect(server.hooks.filter((h) => h.topic === 'orders/create')).toHaveLength(1);
    const gets = mock.calls.filter(
      (c) => (c.init?.method ?? 'GET') === 'GET' && String(c.url).includes('/webhooks.json'),
    );
    expect(gets.length).toBeGreaterThanOrEqual(2);
    expect(String(gets[1]?.url ?? '')).toContain('since_id=');
  });

  it('works with no webhookSecret (HMAC uses the app client secret)', async () => {
    const server = shopifyWebhookServer();
    const mock = shopifyMock(server);
    const store = STORE();
    expect((store.secrets as any).webhookSecret).toBeUndefined();
    const res = await new ShopifyProvider(mock.fetch).ensureWebhooks(store, BASE);
    expect(res.ok).toBe(true);
    expect(res.topics).toEqual(SHOPIFY_WEBHOOK_TOPICS);
  });
});

describe('webhook lifecycle: Custom bridge ensureWebhooks', () => {
  const STORE = () => buildStoreUnit('CUSTOM');

  function wired(bridge: ReferenceBridge) {
    const mock = new MockFetch();
    mock.onPrefix(bridge.baseUrl, bridge.handle);
    return { provider: new CustomBridgeProvider(mock.fetch), mock, bridge };
  }

  it('registers missing topics only; mismatched URL is reported (protocol has no delete)', async () => {
    const bridge = new ReferenceBridge();
    bridge.webhooks.push(
      { topic: 'order.created', url: 'https://old-api.example.test/api/webhooks/stores/custom/store-custom-1' },
      { topic: 'order.updated', url: `${BASE}/api/webhooks/stores/custom/store-custom-1` },
    );
    const { provider, mock } = wired(bridge);
    const res = await provider.ensureWebhooks(STORE(), BASE);
    expect(res.ok).toBe(true);
    expect(res.skipped).toContain('order.updated');
    expect(res.created).toContain('product.updated');
    expect(String(res.reason ?? '')).toMatch(/stale URL for order\.created/);
    // No DELETE exists in protocol §6 — the adapter never attempts one.
    expect(mock.calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(0);
  });

  it('duplicate topics are reported, not deleted (protocol has no delete)', async () => {
    const bridge = new ReferenceBridge();
    bridge.webhooks.push(
      { topic: 'order.created', url: `${BASE}/api/webhooks/stores/custom/store-custom-1` },
      { topic: 'order.created', url: `${BASE}/api/webhooks/stores/custom/store-custom-1` },
    );
    const { provider } = wired(bridge);
    const res = await provider.ensureWebhooks(STORE(), BASE);
    expect(String(res.reason ?? '')).toMatch(/duplicate hooks for order\.created/);
    expect(res.deleted).toBe(0);
  });
});
