import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

export const TENANT_PRISMA_CLIENT_FACTORY = Symbol(
  'TENANT_PRISMA_CLIENT_FACTORY',
);

// Tenant ids are platform UUIDs. Anything else is rejected here, before the
// id reaches the pg Pool `options` string (`-c app.tenant_id=<id>`), where a
// crafted value containing spaces could inject arbitrary `-c` settings.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantPrismaClientFactory = (tenantId: string) => PrismaClient;

interface TenantClientEntry {
  client: PrismaClient;
  lastUsed: number;
}

@Injectable()
export class TenantPrismaManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantPrismaManager.name);
  private readonly clients = new Map<string, TenantClientEntry>();
  private readonly maxClients: number;
  private readonly idleMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Optional()
    @Inject(TENANT_PRISMA_CLIENT_FACTORY)
    private readonly factory?: TenantPrismaClientFactory,
  ) {
    this.maxClients = Math.max(
      1,
      Number(process.env.TENANT_PRISMA_MAX_CLIENTS ?? 100),
    );
    this.idleMs = Math.max(
      10_000,
      Number(process.env.TENANT_PRISMA_IDLE_MS ?? 10 * 60_000),
    );
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => this.pruneIdle(), 60_000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const entry of this.clients.values()) {
      void entry.client.$disconnect().catch(() => undefined);
    }
    this.clients.clear();
  }

  getClient(tenantId: string): PrismaClient {
    if (!tenantId) {
      throw new Error('TenantPrismaManager requires a tenantId');
    }
    if (!UUID_RE.test(tenantId)) {
      throw new Error(
        `TenantPrismaManager requires a UUID tenantId, got ${JSON.stringify(tenantId)}`,
      );
    }

    const existing = this.clients.get(tenantId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    if (this.clients.size >= this.maxClients) {
      this.evictLeastRecentlyUsed();
    }

    const client = this.factory
      ? this.factory(tenantId)
      : this.createDefaultClient(tenantId);
    this.clients.set(tenantId, { client, lastUsed: Date.now() });
    return client;
  }

  pruneIdle(now = Date.now()): number {
    let removed = 0;
    for (const [tenantId, entry] of this.clients.entries()) {
      if (now - entry.lastUsed >= this.idleMs) {
        this.clients.delete(tenantId);
        void entry.client.$disconnect().catch(() => undefined);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.log(`Pruned ${removed} idle tenant database client(s)`);
    }
    return removed;
  }

  getStats(): { tenants: number; maxClients: number; idleMs: number } {
    return {
      tenants: this.clients.size,
      maxClients: this.maxClients,
      idleMs: this.idleMs,
    };
  }

  private evictLeastRecentlyUsed(): void {
    let oldestTenant: string | undefined;
    let oldestUsed = Number.POSITIVE_INFINITY;

    for (const [tenantId, entry] of this.clients.entries()) {
      if (entry.lastUsed < oldestUsed) {
        oldestUsed = entry.lastUsed;
        oldestTenant = tenantId;
      }
    }
    if (!oldestTenant) return;

    const entry = this.clients.get(oldestTenant);
    this.clients.delete(oldestTenant);
    void entry?.client.$disconnect().catch(() => undefined);
    this.logger.log(`Evicted LRU tenant database client: ${oldestTenant}`);
  }

  private createDefaultClient(tenantId: string): PrismaClient {
    const connectionString =
      process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'TENANT_DATABASE_URL (or DATABASE_URL) is required for the tenant runtime',
      );
    }

    const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      options: `-c app.tenant_id=${tenantId}`,
    });
    return new PrismaClient({ adapter: new PrismaPg(pool) });
  }
}
