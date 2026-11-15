import { RlsCoverageService } from './rls-coverage.service';

function serviceWith(rows: any[]) {
  const manager = {
    getClient: jest.fn(() => ({
      $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
    })),
  } as any;
  return new RlsCoverageService(manager);
}

const covered = {
  table_name: 'Product',
  tenant_scoped: true,
  rls_enabled: true,
  rls_forced: true,
  has_policy: true,
  has_trigger: true,
};

describe('RlsCoverageService', () => {
  it('starts when every tenant table is fully covered', async () => {
    await expect(serviceWith([covered]).onModuleInit()).resolves.toBeUndefined();
  });

  it('refuses a table without FORCE RLS', async () => {
    await expect(
      serviceWith([{ ...covered, rls_forced: false }]).onModuleInit(),
    ).rejects.toThrow(/RLS coverage check failed/);
  });

  it('refuses a table without a tenant policy', async () => {
    await expect(
      serviceWith([{ ...covered, has_policy: false }]).onModuleInit(),
    ).rejects.toThrow(/rls=.*policy=false/);
  });

  it('refuses a table without the tenant guard trigger', async () => {
    await expect(
      serviceWith([{ ...covered, has_trigger: false }]).onModuleInit(),
    ).rejects.toThrow(/trigger=false/);
  });

  it('refuses an empty coverage view', async () => {
    await expect(serviceWith([]).onModuleInit()).rejects.toThrow(
      /rls_coverage is empty/,
    );
  });

  it('ignores global reference tables', async () => {
    await expect(
      serviceWith([{ ...covered, tenant_scoped: false, has_policy: false }]).onModuleInit(),
    ).resolves.toBeUndefined();
  });
});
