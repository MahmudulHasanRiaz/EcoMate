import { ForbiddenException } from '@nestjs/common';
import { runWithTenant } from './tenant-context';
import { createTenantPrismaProxy } from './tenant-prisma.proxy';

describe('createTenantPrismaProxy', () => {
  it('keeps target members and forwards model access to the current tenant client', () => {
    const target = {
      own: () => 'own',
      lifecycle: 'target',
    };
    const tenantClient = {
      bar: 'tenant-value',
      foo: jest.fn(() => 'tenant-call'),
    };
    const manager = { getClient: jest.fn(() => tenantClient) };

    const proxy = createTenantPrismaProxy(target, manager as any) as any;

    expect(proxy.own()).toBe('own');
    expect(proxy.lifecycle).toBe('target');

    runWithTenant({ tenantId: 'tenant-a', slug: 'acme' }, () => {
      expect(proxy.foo()).toBe('tenant-call');
      expect(proxy.bar).toBe('tenant-value');
    });

    expect(manager.getClient).toHaveBeenCalledWith('tenant-a');
  });

  it('fails closed outside a tenant context', () => {
    const proxy = createTenantPrismaProxy(
      {},
      { getClient: jest.fn(() => ({ foo: () => 'x' })) } as any,
    ) as any;

    expect(() => proxy.foo()).toThrow(ForbiddenException);
  });
});
