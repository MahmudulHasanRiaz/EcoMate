import { ForbiddenException } from '@nestjs/common';
import {
  getTenantContext,
  requireTenant,
  requireTenantId,
  runWithTenant,
  tenantCompound,
} from './tenant-context';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

describe('tenant context', () => {
  it('provides the context inside runWithTenant and clears it afterwards', () => {
    expect(getTenantContext()).toBeUndefined();

    const seen = runWithTenant(
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        slug: 'acme',
        status: 'ACTIVE',
      },
      () => getTenantContext(),
    );

    expect(seen).toMatchObject({ slug: 'acme', status: 'ACTIVE' });
    expect(getTenantContext()).toBeUndefined();
  });

  it('nests tenant scopes without leaking the outer tenant', () => {
    runWithTenant(
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        slug: 'outer',
      },
      () => {
        expect(requireTenant().slug).toBe('outer');

        runWithTenant(
          {
            tenantId: '22222222-2222-4222-8222-222222222222',
            slug: 'inner',
          },
          () => {
            expect(requireTenantId()).toBe(
              '22222222-2222-4222-8222-222222222222',
            );
          },
        );

        expect(requireTenant().slug).toBe('outer');
      },
    );
  });

  it('fails closed when no tenant context exists', () => {
    expect(() => requireTenant()).toThrow(ForbiddenException);
    expect(() => requireTenantId()).toThrow(ForbiddenException);
  });

  it('rejects an empty tenant id', () => {
    expect(() =>
      runWithTenant({ tenantId: '', slug: 'bad' }, () => undefined),
    ).toThrow('runWithTenant requires a tenantId');
  });

  describe('tenantCompound', () => {
    const OLD_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...OLD_ENV };
    });

    it('uses the current tenant context', () => {
      const result = runWithTenant(
        { tenantId: '11111111-1111-4111-8111-111111111111', slug: 'acme' },
        () => tenantCompound({ key: 'k' }),
      );
      expect(result).toEqual({
        tenantId: '11111111-1111-4111-8111-111111111111',
        key: 'k',
      });
    });

    it('falls back to the hardcoded tenant in test env', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.DEFAULT_TENANT_ID;
      expect(tenantCompound({ key: 'k' })).toEqual({
        tenantId: FALLBACK_TENANT_ID,
        key: 'k',
      });
    });

    it('honours an explicitly configured DEFAULT_TENANT_ID', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEFAULT_TENANT_ID = '22222222-2222-4222-8222-222222222222';
      expect(tenantCompound({ key: 'k' })).toEqual({
        tenantId: '22222222-2222-4222-8222-222222222222',
        key: 'k',
      });
    });

    it('fails closed in production without context or DEFAULT_TENANT_ID', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DEFAULT_TENANT_ID;
      expect(() => tenantCompound({ key: 'k' })).toThrow(
        /Tenant context is required/,
      );
    });

    it('fails closed in development without context or DEFAULT_TENANT_ID', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEFAULT_TENANT_ID;
      expect(() => tenantCompound({ key: 'k' })).toThrow(
        /Tenant context is required/,
      );
    });
  });
});
