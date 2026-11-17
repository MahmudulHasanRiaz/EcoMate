import { Logger } from '@nestjs/common';
import { RlsCoverageService } from './rls-coverage.service';

function serviceWith(rows: any[]) {
  const manager = {
    getClient: jest.fn(() => ({
      $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
    })),
  } as any;
  return new RlsCoverageService(manager);
}

function serviceWithRole(roleRow: any, coverageRows: any[]) {
  const manager = {
    getClient: jest.fn(() => ({
      $queryRawUnsafe: jest.fn((sql: string) =>
        sql.includes('pg_roles')
          ? Promise.resolve(roleRow ? [roleRow] : [])
          : Promise.resolve(coverageRows),
      ),
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

  describe('DB role bypass check', () => {
    const OLD_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...OLD_ENV };
    });

    it('starts when the connected role is a least-privilege role', async () => {
      await expect(
        serviceWithRole(
          { rolname: 'ecomate_tenant_app', rolsuper: false, rolbypassrls: false },
          [covered],
        ).onModuleInit(),
      ).resolves.toBeUndefined();
    });

    it('refuses to start in production as a superuser', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        serviceWithRole(
          { rolname: 'postgres', rolsuper: true, rolbypassrls: true },
          [covered],
        ).onModuleInit(),
      ).rejects.toThrow(/DB role bypass check failed.*superuser/);
    });

    it('refuses to start in production with BYPASSRLS', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        serviceWithRole(
          { rolname: 'ecomate_app', rolsuper: false, rolbypassrls: true },
          [covered],
        ).onModuleInit(),
      ).rejects.toThrow(/DB role bypass check failed.*BYPASSRLS/);
    });

    it('warns but starts outside production as a superuser', async () => {
      process.env.NODE_ENV = 'test';
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        await expect(
          serviceWithRole(
            { rolname: 'postgres', rolsuper: true, rolbypassrls: true },
            [covered],
          ).onModuleInit(),
        ).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('DB role bypass check'),
        );
      } finally {
        warn.mockRestore();
      }
    });
  });
});
