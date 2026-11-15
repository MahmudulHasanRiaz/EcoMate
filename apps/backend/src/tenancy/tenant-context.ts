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
