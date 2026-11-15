import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';

export interface TenantContext {
  tenantId: string;
  slug: string;
  status?: string;
  baseDomain?: string;
  canonicalHost?: string;
  isAlias?: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  if (!context?.tenantId) {
    throw new Error('runWithTenant requires a tenantId');
  }
  return tenantStorage.run(context, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenant(): TenantContext {
  const context = tenantStorage.getStore();
  if (!context?.tenantId) {
    throw new ForbiddenException('Tenant context is required');
  }
  return context;
}

export function requireTenantId(): string {
  return requireTenant().tenantId;
}

/**
 * Build the tenant-composite unique-key payload:
 *   tenantCompound({ key }) -> { tenantId: <current>, key }
 * Used for update/delete/upsert where clauses whose old unique key is now
 * [tenantId, ...fields].
 */
export function tenantCompound<T extends Record<string, unknown>>(
  fields: T,
): T & { tenantId: string } {
  // Transitional bridge while the request middleware/proxy is being wired:
  // unit tests and the single-tenant dev runtime use DEFAULT_TENANT_ID.
  // Once the tenant middleware is enabled, this fallback is removed.
  const tenantId =
    getTenantContext()?.tenantId ||
    process.env.DEFAULT_TENANT_ID ||
    '00000000-0000-4000-8000-000000000000';
  return { tenantId, ...fields };
}
