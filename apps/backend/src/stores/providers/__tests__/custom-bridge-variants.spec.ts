/**
 * Custom bridge `upsertVariants` — stale-`__externalVariantId` fallback (V1).
 *
 * Like Shopify, the bridge never shared the duplication defect (it
 * SKU-matches before creating), but once `syncVariants` passes the mapped
 * id, a stale id would PUT to a dead variant instead of falling back to
 * the SKU match. Proves the candidate order against the in-repo reference
 * bridge: mapped id → SKU match → create.
 */
import { CustomBridgeProvider } from '../custom-bridge.provider';
import { MockFetch, buildStoreUnit } from './fixtures';
import { ReferenceBridge } from './reference-bridge';

const STORE = () => buildStoreUnit('CUSTOM');

function wired() {
  const bridge = new ReferenceBridge();
  const mock = new MockFetch();
  mock.onPrefix(bridge.baseUrl, bridge.handle);
  const provider = new CustomBridgeProvider(mock.fetch);
  return { provider, mock, bridge };
}

describe('Custom bridge upsertVariants stale-id fallback (V1)', () => {
  it('stale __externalVariantId + live SKU match → PUTs the SKU-matched variant', async () => {
    const { provider, mock, bridge } = wired();
    const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-V1', name: 'V' } as any, ['name', 'sku']);
    const first = await provider.upsertVariants(STORE(), ref, [{ sku: 'SKU-VAR-A', price: '400' }] as any);
    const liveId = first.get('SKU-VAR-A')!.providerId;
    mock.calls.length = 0;
    const out = await provider.upsertVariants(STORE(), ref, [
      { sku: 'SKU-VAR-A', price: '410', __externalVariantId: 'dead-99' },
    ] as any);
    expect(out.get('SKU-VAR-A')?.providerId).toBe(liveId);
    expect(bridge.variants.get(ref.providerId)).toHaveLength(1);
    const puts = mock.calls.filter(
      (c) => c.url.includes('/bridge/v1/variants/') && c.init?.method === 'PUT',
    );
    expect(puts.map((c) => c.url)).toEqual([
      expect.stringContaining('/bridge/v1/variants/dead-99'),
      expect.stringContaining(`/bridge/v1/variants/${liveId}`),
    ]);
    expect(
      mock.calls.filter((c) => c.url.endsWith('/variants') && c.init?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('stale __externalVariantId + no SKU match → POST create', async () => {
    const { provider, mock, bridge } = wired();
    const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-V2', name: 'V' } as any, ['name', 'sku']);
    const out = await provider.upsertVariants(STORE(), ref, [
      { sku: 'SKU-VAR-A', price: '400', __externalVariantId: 'dead-99' },
    ] as any);
    expect(out.get('SKU-VAR-A')?.providerId).toBeDefined();
    expect(bridge.variants.get(ref.providerId)).toHaveLength(1);
    expect(
      mock.calls.filter((c) => c.url.includes('/bridge/v1/variants/dead-99') && c.init?.method === 'PUT'),
    ).toHaveLength(1);
    expect(
      mock.calls.filter((c) => c.url.endsWith('/variants') && c.init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('live __externalVariantId → single PUT, no create', async () => {
    const { provider, mock, bridge } = wired();
    const ref = await provider.upsertProduct(STORE(), { sku: 'SKU-BR-V3', name: 'V' } as any, ['name', 'sku']);
    const first = await provider.upsertVariants(STORE(), ref, [{ sku: 'SKU-VAR-A', price: '400' }] as any);
    const liveId = first.get('SKU-VAR-A')!.providerId;
    mock.calls.length = 0;
    const out = await provider.upsertVariants(STORE(), ref, [
      { sku: 'SKU-VAR-A', price: '410', __externalVariantId: liveId },
    ] as any);
    expect(out.get('SKU-VAR-A')?.providerId).toBe(liveId);
    expect(bridge.variants.get(ref.providerId)).toHaveLength(1);
    expect(
      mock.calls.filter((c) => c.url.includes('/bridge/v1/variants/') && c.init?.method === 'PUT'),
    ).toHaveLength(1);
    expect(
      mock.calls.filter((c) => c.url.endsWith('/variants') && c.init?.method === 'POST'),
    ).toHaveLength(0);
  });
});
