import { requireTenant } from './tenant-context';
import type { TenantPrismaManager } from './tenant-prisma.manager';

export function createTenantPrismaProxy<T extends object>(
  target: T,
  manager: Pick<TenantPrismaManager, 'getClient'>,
): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      if (property in object) {
        return Reflect.get(object, property, receiver);
      }

      const client = manager.getClient(requireTenant().tenantId) as any;
      const value = client[property];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}
