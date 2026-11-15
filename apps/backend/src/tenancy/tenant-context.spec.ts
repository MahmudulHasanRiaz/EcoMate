import { ForbiddenException } from '@nestjs/common';
import {
  getTenantContext,
  requireTenant,
  requireTenantId,
  runWithTenant,
} from './tenant-context';

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
});
