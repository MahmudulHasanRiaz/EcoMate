/**
 * Internal stores controller — Phase 9 §8.2.2 (D-1 fix round).
 *
 * The platform force-unbind flow calls POST
 * /internal/stores/:storeId/release-identity with an explicit tenant id +
 * slug; the controller runs the release inside that tenant's context so
 * RLS scopes the update to the tenant's own Store row. (The guard itself
 * is PlatformServiceTokenGuard, covered by the provisioning specs — this
 * spec locks the delegation + tenant-context wiring.)
 */
import { getTenantContext } from '../tenancy/tenant-context';
import { InternalStoresController } from './internal-stores.controller';

describe('InternalStoresController', () => {
  it('releases the identity inside the DTO tenant context', async () => {
    let seenContext: unknown;
    const stores = {
      releaseIdentity: jest.fn(async (storeId: string) => {
        seenContext = getTenantContext();
        return { released: true, storeId };
      }),
    };
    const controller = new InternalStoresController(stores as any);

    const out = await controller.releaseIdentity('store-1', {
      tenantId: '11111111-1111-4111-8111-111111111111',
      slug: 'acme',
    } as any);

    expect(out).toEqual({ released: true, storeId: 'store-1' });
    expect(stores.releaseIdentity).toHaveBeenCalledWith('store-1');
    expect(seenContext).toMatchObject({
      tenantId: '11111111-1111-4111-8111-111111111111',
      slug: 'acme',
    });
  });

  it('passes through released:false (row already gone — not an error)', async () => {
    const stores = {
      releaseIdentity: jest.fn(async (storeId: string) => ({ released: false, storeId })),
    };
    const controller = new InternalStoresController(stores as any);

    await expect(
      controller.releaseIdentity('store-gone', {
        tenantId: '11111111-1111-4111-8111-111111111111',
        slug: 'acme',
      } as any),
    ).resolves.toEqual({ released: false, storeId: 'store-gone' });
  });
});
