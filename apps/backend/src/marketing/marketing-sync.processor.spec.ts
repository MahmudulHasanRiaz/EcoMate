import { MarketingSyncProcessor } from './marketing-sync.processor';
import { TenantRegistryService } from '../tenancy/tenant-registry.service';
import { getTenantContext } from '../tenancy/tenant-context';

describe('MarketingSyncProcessor tenant routing', () => {
  const sync = {
    syncAll: jest.fn(),
    syncAdAccount: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    sync.syncAll.mockResolvedValue([{ adAccountId: 'acct-1' }]);
    sync.syncAdAccount.mockResolvedValue({ adAccountId: 'acct-1' });
  });

  it('fans a system sync-all out to every active tenant', async () => {
    const registry = new TenantRegistryService();
    registry.replace([
      { id: 'a', slug: 'alpha', status: 'active', hosts: [] },
      { id: 'b', slug: 'beta', status: 'active', hosts: [] },
      { id: 'c', slug: 'off', status: 'suspended', hosts: [] },
    ]);
    const processor = new MarketingSyncProcessor(sync, registry);
    const seen: string[] = [];
    sync.syncAll.mockImplementation(async () => {
      seen.push(getTenantContext()!.tenantId);
      return [{ adAccountId: 'acct-1' }];
    });

    const result = await processor.process({
      name: 'sync-all',
      id: 'j1',
      data: { type: 'sync-all' },
    } as any);

    expect(seen).toEqual(['a', 'b']);
    expect(result).toHaveLength(2);
  });

  it('runs a tenant-stamped sync-account inside ALS', async () => {
    const registry = new TenantRegistryService();
    const processor = new MarketingSyncProcessor(sync, registry);
    let seen: string | undefined;
    sync.syncAdAccount.mockImplementation(async () => {
      seen = getTenantContext()?.tenantId;
      return { adAccountId: 'acct-1' };
    });

    await processor.process({
      name: 'sync-account',
      id: 'j2',
      data: {
        type: 'sync-account',
        adAccountId: 'acct-1',
        tenantId: 'a',
        tenantSlug: 'alpha',
      },
    } as any);

    expect(seen).toBe('a');
    expect(sync.syncAdAccount).toHaveBeenCalledWith('acct-1', undefined);
  });
});
