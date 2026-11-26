/**
 * Prisma clients for the three databases the Phase 2 scripts touch.
 *
 *  - tenant:   the backend (tenant-DB) schema — root `@prisma/client`
 *              (default generator output, `node_modules/.prisma/client`).
 *  - platform: `apps/platform-api/src/generated/prisma` (its own output dir).
 *  - auth:     `apps/auth-service/src/generated/prisma` (target, ecomate_auth).
 *
 * All three use Prisma 7 driver adapters (pg Pool + PrismaPg), mirroring
 * the existing script convention in apps/backend/prisma/scripts/.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '../../../platform-api/src/generated/prisma/index.js';
import { PrismaClient as AuthPrismaClient } from '../../src/generated/prisma/index.js';
import type { MigrationEnv } from './migration-common.js';

export type { TenantPrismaClient, PlatformPrismaClient, AuthPrismaClient };

export interface MigrationClients {
  tenant: TenantPrismaClient;
  platform: PlatformPrismaClient;
  auth: AuthPrismaClient;
  close: () => Promise<void>;
}

function makePool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 5 });
}

export function makeClients(env: MigrationEnv): MigrationClients {
  const tenantPool = makePool(env.tenantDbUrl);
  const platformPool = makePool(env.platformDbUrl);
  const authPool = makePool(env.authDbUrl);
  const tenant = new TenantPrismaClient({
    adapter: new PrismaPg(tenantPool),
  }) as TenantPrismaClient;
  const platform = new PlatformPrismaClient({
    adapter: new PrismaPg(platformPool),
  }) as PlatformPrismaClient;
  const auth = new AuthPrismaClient({
    adapter: new PrismaPg(authPool),
  }) as AuthPrismaClient;
  return {
    tenant,
    platform,
    auth,
    close: async () => {
      await tenant.$disconnect().catch(() => undefined);
      await platform.$disconnect().catch(() => undefined);
      await auth.$disconnect().catch(() => undefined);
      await tenantPool.end().catch(() => undefined);
      await platformPool.end().catch(() => undefined);
      await authPool.end().catch(() => undefined);
    },
  };
}
