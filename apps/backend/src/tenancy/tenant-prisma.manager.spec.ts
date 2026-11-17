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

    const a1 = manager.getClient('11111111-1111-4111-8111-111111111111');
    const a2 = manager.getClient('11111111-1111-4111-8111-111111111111');
    const b = manager.getClient('22222222-2222-4222-8222-222222222222');

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

    manager.getClient('11111111-1111-4111-8111-111111111111');
    manager.getClient('22222222-2222-4222-8222-222222222222');
    manager.getClient('33333333-3333-4333-8333-333333333333');

    expect(manager.getStats().tenants).toBe(2);
    expect(clients['11111111-1111-4111-8111-111111111111'].$disconnect).toHaveBeenCalled();
  });

  it('prunes idle clients and disconnects them', () => {
    const factory = jest.fn(() => fakeClient());
    const manager = new TenantPrismaManager(factory);
    const client = manager.getClient('11111111-1111-4111-8111-111111111111');

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

  it('rejects a non-UUID tenant id', () => {
    const manager = new TenantPrismaManager(() => fakeClient());
    expect(() => manager.getClient('tenant-a')).toThrow(
      'TenantPrismaManager requires a UUID tenantId',
    );
    expect(() => manager.getClient('not-a-uuid')).toThrow(
      'TenantPrismaManager requires a UUID tenantId',
    );
  });

  it('rejects a Postgres option-injection attempt in the tenant id', () => {
    // The tenant id is interpolated into the pg Pool `options` string
    // (`-c app.tenant_id=<id>`); a value with spaces could inject `-c`
    // settings. The UUID assertion closes that vector.
    const manager = new TenantPrismaManager(() => fakeClient());
    expect(() =>
      manager.getClient('11111111-1111-4111-8111-111111111111 -c log_statement=all'),
    ).toThrow('TenantPrismaManager requires a UUID tenantId');
  });

  it('accepts the fallback tenant UUID', () => {
    const factory = jest.fn(() => fakeClient());
    const manager = new TenantPrismaManager(factory);
    const client = manager.getClient('00000000-0000-4000-8000-000000000000');
    expect(client).toBeDefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
