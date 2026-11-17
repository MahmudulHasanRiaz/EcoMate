import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';

export interface TenantContext {
  tenantId: string;
  slug: string;
  status?: string;
  baseDomain?: string;
  canonicalHost?: string;
  isAlias?: boolean;
  /**
   * Set by DualModeAuthGuard when the request authenticates with an
   * impersonated JWT (`imp: true`). The security-event emitter stamps it
   * into the tenant audit trail so impersonated actions are attributable.
   * `actor` is the platform operator identity when the impersonation
   * exchange supplied one (the platform consume response does not return
   * it yet, so it is usually null — the flag is always stamped).
   */
  impersonation?: {
    impersonated: boolean;
    actor?: string | null;
  };
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
 *
 * The hardcoded fallback tenant is TEST-ONLY (same gating as
 * tenant-job.ts / page-view-buffer.service.ts): in production a missing
 * tenant context fails closed instead of silently targeting the fallback
 * tenant's rows. An explicitly configured DEFAULT_TENANT_ID remains the
 * operator's maintenance bridge in every environment.
 */
export function tenantCompound<T extends Record<string, unknown>>(
  fields: T,
): T & { tenantId: string } {
  const tenantId =
    getTenantContext()?.tenantId ||
    process.env.DEFAULT_TENANT_ID ||
    (process.env.NODE_ENV === 'test'
      ? '00000000-0000-4000-8000-000000000000'
      : undefined);
  if (!tenantId) {
    throw new Error(
      'Tenant context is required (no tenant in context and no DEFAULT_TENANT_ID configured)',
    );
  }
  return { tenantId, ...fields };
}
