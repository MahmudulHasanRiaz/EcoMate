import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTenantContext } from '../tenancy/tenant-context';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

function createBaPrisma(tenantId?: string): PrismaClient {
  const url =
    process.env.TENANT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres@localhost:5432/ecomate_web';
  const effectiveTenant =
    tenantId || process.env.DEFAULT_TENANT_ID || FALLBACK_TENANT_ID;
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
