import { resolveBaTenantId } from './prisma';
import { runWithTenant } from '../tenancy/tenant-context';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

describe('resolveBaTenantId', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('prefers an explicit tenant id', () => {
    expect(
      resolveBaTenantId('11111111-1111-4111-8111-111111111111'),
    ).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('uses the current tenant context', () => {
    const resolved = runWithTenant(
      { tenantId: '11111111-1111-4111-8111-111111111111', slug: 'acme' },
      () => resolveBaTenantId(),
    );
    expect(resolved).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('falls back to the hardcoded tenant in test env', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DEFAULT_TENANT_ID;
    expect(resolveBaTenantId()).toBe(FALLBACK_TENANT_ID);
  });

  it('honours an explicitly configured DEFAULT_TENANT_ID', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEFAULT_TENANT_ID = '22222222-2222-4222-8222-222222222222';
    expect(resolveBaTenantId()).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('fails closed in production without context or DEFAULT_TENANT_ID', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEFAULT_TENANT_ID;
    expect(() => resolveBaTenantId()).toThrow(
      /Better Auth requires a tenant context/,
    );
  });
});
