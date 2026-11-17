import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTenantContext } from '../tenancy/tenant-context';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Resolve the tenant a Better Auth client is scoped to. The hardcoded
 * fallback tenant is TEST-ONLY (same gating as tenant-job.ts): outside
 * test env, a missing tenant context with no DEFAULT_TENANT_ID fails
 * closed instead of silently scoping auth reads/writes to the fallback
 * tenant. An explicitly configured DEFAULT_TENANT_ID remains the
 * operator's maintenance bridge in every environment.
 */
export function resolveBaTenantId(tenantId?: string): string {
  const effective =
    tenantId ||
    getTenantContext()?.tenantId ||
    process.env.DEFAULT_TENANT_ID ||
    (process.env.NODE_ENV === 'test' ? FALLBACK_TENANT_ID : undefined);
  if (!effective) {
    throw new Error(
      'Better Auth requires a tenant context (no tenant in context and no DEFAULT_TENANT_ID configured)',
    );
  }
  return effective;
}

function createBaPrisma(tenantId?: string): PrismaClient {
  const url =
    process.env.TENANT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres@localhost:5432/ecomate_web';
  const effectiveTenant = resolveBaTenantId(tenantId);
  const pool = new Pool({
    connectionString: url,
    max: 4,
    options: `-c app.tenant_id=${effectiveTenant}`,
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

type BaPrismaResolver = () => PrismaClient;
let resolver: BaPrismaResolver | null = null;

/** Installed by main.ts so the Better Auth adapter follows the request tenant. */
export function setBaPrismaResolver(fn: BaPrismaResolver | null): void {
  resolver = fn;
}

let fallbackClient: PrismaClient | undefined;

export const baPrisma = new Proxy({} as PrismaClient, {
  get(_, prop: string | symbol) {
    const client =
      resolver?.() ??
      (fallbackClient ??= createBaPrisma(getTenantContext()?.tenantId));
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
