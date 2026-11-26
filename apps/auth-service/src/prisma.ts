// Prisma client for the dedicated `ecomate_auth` database.
// Mirrors apps/platform-api: Prisma 7 driver-adapter construction
// (pg Pool + PrismaPg). The schema datasource url (env AUTH_DB_URL) is for
// the migrate CLI; the runtime client connects through this adapter.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/index.js';
import { Pool } from 'pg';
import type { AuthServiceConfig } from './config.js';

let client: PrismaClient | null = null;
let pool: Pool | null = null;

export function getPrisma(config: AuthServiceConfig): PrismaClient {
  if (!client) {
    pool = new Pool({ connectionString: config.authDbUrl, max: 10 });
    client = new PrismaClient({ adapter: new PrismaPg(pool) });
  }
  return client;
}

/** Test-only: drop the cached client + pool (lets tests reconnect fresh). */
export async function closePrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}
