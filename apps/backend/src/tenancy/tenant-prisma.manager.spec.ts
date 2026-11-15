import { TenantPrismaManager } from './tenant-prisma.manager';

function fakeClient() {
  return {
    $disconnect: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('TenantPrismaManager', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.TENANT_PRISMA_MAX_CLIENTS = '2';
    process.env.TENANT_PRISMA_IDLE_MS = '1000';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reuses a client for the same tenant and creates one per tenant', () => {
    const factory = jest.fn(() => fakeClient());
    const manager = new TenantPrismaManager(factory);

    const a1 = manager.getClient('tenant-a');
    const a2 = manager.getClient('tenant-a');
    const b = manager.getClient('tenant-b');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.getStats().tenants).toBe(2);
  });

  it('evicts the least recently used client above the cap', () => {
    const clients: Record<string, any> = {};
    const factory = jest.fn((tenantId: string) => {
      const client = fakeClient();
      clients[tenantId] = client;
      return client;
    });
    const manager = new TenantPrismaManager(factory);

    manager.getClient('tenant-a');
    manager.getClient('tenant-b');
    manager.getClient('tenant-c');

    expect(manager.getStats().tenants).toBe(2);
    expect(clients['tenant-a'].$disconnect).toHaveBeenCalled();
  });

  it('prunes idle clients and disconnects them', () => {
    const factory = jest.fn(() => fakeClient());
    const manager = new TenantPrismaManager(factory);
    const client = manager.getClient('tenant-a');

    const removed = manager.pruneIdle(Date.now() + 20_000);

    expect(removed).toBe(1);
    expect(client.$disconnect).toHaveBeenCalled();
    expect(manager.getStats().tenants).toBe(0);
  });

  it('rejects an empty tenant id', () => {
    const manager = new TenantPrismaManager(() => fakeClient());
    expect(() => manager.getClient('')).toThrow(
      'TenantPrismaManager requires a tenantId',
    );
  });
});
