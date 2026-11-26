// Patch BigInt serialization (Prisma aggregation returns BigInt) —
// same patch as main.ts; queue processors share the same services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

/**
 * Queue-worker entrypoint — worker split, workstream E (Phase 9, P1
 * "separate worker service(s)").
 *
 * Same AppModule as the HTTP API, but as an application context: no HTTP
 * server is ever created, so nothing can bind a port. What runs is decided
 * by WORKER_MODE (see common/worker-mode.ts):
 *   - WORKER_MODE=worker (the compose `worker` service): queue processors
 *     only; schedulers are NOT registered.
 *   - WORKER_MODE=all (default): processors + schedulers, still no HTTP.
 *   - WORKER_MODE=api: refused — api mode requires the HTTP entrypoint
 *     (main.ts); starting it here would silently drop the API.
 *
 * Deliberately NOT startup.sh: the worker must never run migrations,
 * role provisioning, or seeds — the `backend` service owns those, and two
 * processes running `prisma migrate deploy` concurrently would fight over
 * the migration lock. The worker only needs the runtime env (DB/Redis/
 * secrets) that compose gives both services.
 *
 * Run: `node dist/src/worker.main` (or `npm run start:worker`).
 */
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLoggerService } from 'nestjs-pino';
import { AppModule } from './app.module';
import { join } from 'path';
import { initSentry } from './observability/sentry';
import { TenantPrismaManager } from './tenancy/tenant-prisma.manager';
import { tenantStorage } from './tenancy/tenant-context';
import { setBaPrismaResolver } from './better-auth/prisma';
import { getTenantAuthMode } from './common/tenant-auth-mode';
import { parseWorkerMode } from './common/worker-mode';

async function bootstrap() {
  // Load .env — try project root, backend root, then cwd (same as main.ts).
  const { config } = await import('dotenv');
  config({ path: join(__dirname, '..', '..', '..', '..', '.env') }); // monorepo root
  config({ path: join(__dirname, '..', '..', '.env') }); // apps/backend/
  config(); // cwd fallback

  if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET and JWT_REFRESH_SECRET are required in production. Set them via environment variables.',
      );
    }
    console.warn(
      '[bootstrap] JWT_SECRET/JWT_REFRESH_SECRET not set — using dev defaults',
    );
    process.env['JWT_SECRET'] =
      process.env['JWT_SECRET'] ||
      'eco-mate-jwt-secret-change-in-production-2026';
    process.env['JWT_REFRESH_SECRET'] =
      process.env['JWT_REFRESH_SECRET'] ||
      'eco-mate-refresh-secret-change-in-production-2026';
  }

  const workerMode = parseWorkerMode();
  if (workerMode === 'api') {
    throw new Error(
      'WORKER_MODE=api must be started via main.ts (node dist/src/main) — ' +
        'worker.main.ts never serves HTTP.',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  // Phase 8 Stage 2 item 19: JSON logs for every `new Logger()` call site.
  app.useLogger(app.get(PinoLoggerService));
  // Phase 8 Stage 2 item 20: Sentry is inert without a real SENTRY_DSN.
  // serverName 'backend-worker' so worker errors are distinguishable from
  // API errors in Sentry without changing any alert routing.
  initSentry('backend-worker');
  app.enableShutdownHooks();

  // Better Auth tenant resolution for queue paths that touch baPrisma
  // (users/customers/employees services). Same resolver as main.ts: the
  // per-job tenant comes from ALS (TenantWorkerHost sets it); the hardcoded
  // fallback tenant is TEST-ONLY, exactly as in main.ts.
  // Phase 3: legacy-jwt only — in central-ba mode queue paths use the
  // central service over HTTP (same flag-gated services as the HTTP
  // entrypoint), so the resolver install is skipped here too.
  const tenantManager = app.get(TenantPrismaManager);
  const defaultTenantId =
    process.env.DEFAULT_TENANT_ID ||
    (process.env.NODE_ENV === 'test'
      ? '00000000-0000-4000-8000-000000000000'
      : undefined);
  if (getTenantAuthMode() === 'legacy-jwt') {
    setBaPrismaResolver(() => {
      const tenantId = tenantStorage.getStore()?.tenantId || defaultTenantId;
      if (!tenantId) {
        throw new Error(
          'Better Auth requires a tenant context (no tenant in context and no DEFAULT_TENANT_ID configured)',
        );
      }
      return tenantManager.getClient(tenantId);
    });
  }

  console.log(
    `[worker] WORKER_MODE=${workerMode} — queue processors active, ` +
      `schedulers ${workerMode === 'worker' ? 'disabled' : 'enabled'}, ` +
      `no HTTP server (application context only), ` +
      `tenant-auth-mode=${getTenantAuthMode()}`,
  );
}
// Worker split (WORKER_MODE): a failed bootstrap (including the
 // mode-mismatch refusal above) must exit NON-ZERO. A bare bootstrap()
 // leaves the rejection to the unhandledRejection handler below, which
 // only logs — and the process then exits 0 once the event loop drains,
 // so a swapped entrypoint (or a DB-down boot) looks like a clean exit
 // to Docker/systemd. Handle it here instead.
bootstrap().catch((err) => {
  console.error(
    '[FATAL] Bootstrap failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});

// Global error handlers to prevent process crash on unhandled rejections
// (mirrors main.ts).
process.on('unhandledRejection', (reason) => {
  console.error(
    '[FATAL] Unhandled Rejection:',
    reason instanceof Error ? reason.message : reason,
  );
});
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error.message);
});
