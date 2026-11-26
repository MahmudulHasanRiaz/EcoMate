// Patch BigInt serialization for JSON responses (Prisma aggregation returns BigInt)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { Logger as PinoLoggerService, PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { join } from 'path';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { initSentry } from './observability/sentry';
import { registerBullBoard } from './observability/bull-board.setup';
import { CacheService } from './cache/cache.service';
import { PrismaService } from './prisma/prisma.service';
import { TenantPrismaManager } from './tenancy/tenant-prisma.manager';
import { tenantStorage } from './tenancy/tenant-context';
import { setBaPrismaResolver } from './better-auth/prisma';
import { getTenantAuthMode } from './common/tenant-auth-mode';
import { randomUUID } from 'crypto';
import { parseWorkerMode } from './common/worker-mode';

async function bootstrap() {
  // Load .env — try project root, backend root, then cwd
  const { config } = await import('dotenv');
  config({ path: join(__dirname, '..', '..', '..', '..', '.env') }); // monorepo root
  config({ path: join(__dirname, '..', '..', '.env') }); // apps/backend/
  config(); // cwd fallback

  // Worker split (WORKER_MODE): this is the HTTP entrypoint. `worker` mode
  // has no HTTP server — it runs queue processors only via worker.main.ts.
  // Fail fast on the mismatch instead of silently serving HTTP as a worker.
  // (`api` mode additionally leaves the @Processor providers unregistered —
  // see common/worker-mode.ts; `all` is today's behaviour, unchanged.)
  const workerMode = parseWorkerMode();
  if (workerMode === 'worker') {
    throw new Error(
      'WORKER_MODE=worker must be started via worker.main.ts ' +
        '(node dist/src/worker.main) — main.ts always serves HTTP.',
    );
  }

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

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // disableRequestLogging: Fastify's own per-request lines are untagged
    // JSON; the onResponse hook below emits the single structured access
    // log (tenantId + requestId) instead. request.log.error still works.
    // genReqId: Fastify assigns request.id BEFORE pino-http runs, and
    // pino-http only calls its own genReqId when req.id is unset — so the
    // header-derived id must be assigned HERE, or every request logs as
    // req-N. Same rule as CorrelationIdMiddleware (x-correlation-id or a
    // fresh UUID) so req.id, req.log bindings, and the access log agree.
    new FastifyAdapter({
      trustProxy: true,
      disableRequestLogging: true,
      genReqId: (req) =>
        (req.headers['x-correlation-id'] as string) || randomUUID(),
    }),
  );
  // Phase 8 Stage 2 item 19: JSON logs for every `new Logger()` call site.
  app.useLogger(app.get(PinoLoggerService));
  // Phase 8 Stage 2 item 20: Sentry is inert without a real SENTRY_DSN.
  initSentry('backend');
  app.enableShutdownHooks();
  const cacheService = app.get(CacheService);
  const prismaService = app.get(PrismaService);
  const tenantManager = app.get(TenantPrismaManager);
  // The hardcoded fallback tenant is TEST-ONLY (same gating as
  // tenant-job.ts): in production a Better Auth call without tenant
  // context fails closed instead of silently scoping to the fallback
  // tenant. An explicitly configured DEFAULT_TENANT_ID remains the
  // operator's maintenance bridge in every environment.
  const defaultTenantId =
    process.env.DEFAULT_TENANT_ID ||
    (process.env.NODE_ENV === 'test'
      ? '00000000-0000-4000-8000-000000000000'
      : undefined);
  // Phase 3: the tenant Better Auth instance (baPrisma + this resolver)
  // is LEGACY-JWT ONLY. In central-ba mode no code path touches the
  // tenant BA instance — sessions are verified over HTTP by
  // CentralSessionAuthGuard and BA rows are written by the central
  // service — so the resolver install is skipped and a stray baPrisma
  // use fails loudly instead of silently scoping to the wrong tenant.
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
  let durableMaintenanceMemo: {
    expiresAt: number;
    value?: { mode: 'full_backup' | 'restore' };
  } = { expiresAt: 0 };
  const activeWriteMarkers = new Map<string, string>();
  const clearActiveWriteMarker = async (requestId: string) => {
    const marker = activeWriteMarkers.get(requestId);
    if (!marker) return;
    activeWriteMarkers.delete(requestId);
    await cacheService.delete(marker);
  };

  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.r2.dev',
          'https://images.unsplash.com',
        ],
        connectSrc: [
          "'self'",
          'https://*.r2.dev',
          ...(process.env['CSP_CONNECT_SRC']
            ? [process.env['CSP_CONNECT_SRC']]
            : []),
        ],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  });

  await app.register(compress);

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      let pathname = request.url.split('?', 1)[0];
      try {
        pathname = decodeURIComponent(pathname);
      } catch {
        return reply.code(400).send({ message: 'Malformed request path' });
      }
      // Legacy local backups were written beneath uploads before private
      // backup storage existed. Never expose them through the public static
      // media route; authenticated backup streaming remains available.
      if (
        pathname === '/uploads/backups' ||
        pathname.startsWith('/uploads/backups/')
      ) {
        return reply.code(404).send({ message: 'Not found' });
      }

      const isHealthRead =
        (request.method === 'GET' || request.method === 'HEAD') &&
        pathname.startsWith('/api/health');
      const isTrackedWrite =
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        (pathname.startsWith('/api/') || pathname.startsWith('/uploads/'));
      if (isTrackedWrite) {
        const marker =
          `system:backup-active-write:${process.pid}:` +
          `${request.id}:${randomUUID()}`;
        activeWriteMarkers.set(String(request.id), marker);
        await cacheService.set(
          marker,
          { startedAt: new Date().toISOString() },
          24 * 60 * 60 * 1000,
        );
      }
      let maintenance = await cacheService.get<{
        mode?: 'full_backup' | 'restore';
      }>('system:backup-maintenance');
      if (
        !maintenance &&
        !isHealthRead &&
        (pathname.startsWith('/api/') || pathname.startsWith('/uploads/'))
      ) {
        const requestIsRead =
          request.method === 'GET' || request.method === 'HEAD';
        if (!requestIsRead || durableMaintenanceMemo.expiresAt <= Date.now()) {
          try {
            const tableRows = await prismaService.rawQuery<{ exists: boolean }>(
              `SELECT to_regclass('ecomate_control.backup_restore_operation') IS NOT NULL AS "exists"`,
            );
            let durableRestoring = false;
            if (tableRows[0]?.exists === true) {
              const restoreRows = await prismaService.rawQuery<{ active: boolean }>(
                `SELECT EXISTS (
                  SELECT 1
                  FROM "ecomate_control"."backup_restore_operation"
                  WHERE "phase" IN ('preparing','database_committed','failed_after_commit')
                ) AS "active"`,
              );
              durableRestoring = restoreRows[0]?.active === true;
            }
            const sessionRows = await prismaService.rawQuery<{ active: boolean }>(
              `SELECT EXISTS (
                SELECT 1
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND application_name = 'ecomate-backup-restore'
              ) AS "active"`,
            );
            const restoreActive = sessionRows[0]?.active === true || durableRestoring;
            const durableOwner = restoreActive
              ? { status: 'restoring' }
              : await prismaService.backupJob.findFirst({
                  where: {
                    OR: [
                      { status: 'restoring' },
                      { status: 'running', scope: 'db_files' },
                    ],
                  },
                  select: { status: true },
                });
            durableMaintenanceMemo = {
              expiresAt: Date.now() + 1000,
              value: durableOwner
                ? {
                    mode:
                      durableOwner.status === 'restoring'
                        ? 'restore'
                        : 'full_backup',
                  }
                : undefined,
            };
          } catch {
            // During psql DDL phases the catalog itself can be momentarily
            // unavailable. Fail closed for API/media traffic, but health checks
            // were excluded above so the container is not restarted mid-restore.
            durableMaintenanceMemo = {
              expiresAt: Date.now() + 1000,
              value: { mode: 'restore' },
            };
          }
        }
        maintenance = durableMaintenanceMemo.value;
      }
      if (maintenance?.mode && request.method !== 'OPTIONS') {
        const isRead = request.method === 'GET' || request.method === 'HEAD';
        const isBackupRead = isRead && pathname.startsWith('/api/admin/backup');
        const apiOrMediaRequest =
          pathname.startsWith('/api/') || pathname.startsWith('/uploads/');
        const shouldBlock =
          apiOrMediaRequest &&
          !isBackupRead &&
          !isHealthRead &&
          (maintenance.mode === 'restore' || !isRead);

        if (shouldBlock) {
          reply.header('Retry-After', '30');
          return reply.code(503).send({
            statusCode: 503,
            message:
              maintenance.mode === 'restore'
                ? 'Restore in progress; retry shortly'
                : 'Full backup snapshot in progress; writes are temporarily paused',
          });
        }
      }
      if (
        pathname.startsWith('/uploads/') &&
        (request.method === 'POST' || request.method === 'PUT')
      ) {
        const contentType = request.headers['content-type'];
        if (contentType && !contentType.startsWith('image/')) {
          console.warn(
            `Non-image upload attempt: ${request.method} ${request.url} (${contentType})`,
          );
        }
      }
    });

  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    // Local restore can atomically replace bytes at the same media URL. Do not
    // instruct browsers/CDNs to pin that path for a year. This 1h TTL is for
    // ORIGINALS — derivatives get the long immutable TTL in setHeaders below.
    maxAge: 60 * 60 * 1000,
    immutable: false,
    // SECURITY (2026-10-25, F15): /uploads/ serves user-controlled files
    // (incl. stored HTML/SVG) from the API origin. Sandbox + nosniff mean
    // a stored HTML file can never run scripts or be sniffed into an
    // executable type in a visitor's browser, even if one slips past the
    // MIME-only extension rule.
    setHeaders: (res, filePath) => {
      res.header('Content-Security-Policy', 'sandbox');
      res.header('X-Content-Type-Options', 'nosniff');
      // Speed Plan P4: derivatives are generated bytes keyed by media id
      // (`uploads/derivatives/<mediaId>/<size>.webp|jpg`) — a media change
      // produces a new media id / URL, so a derivative URL's bytes never
      // change in place. They can safely be pinned for a year, immutable.
      // (@fastify/static invokes setHeaders after its own Cache-Control is
      // applied, so this overrides the 1h default for this subtree only.)
      // Originals keep the 1h TTL above: the restore concern in the comment
      // on maxAge applies to them, because a restore can replace an
      // original's bytes at the same URL.
      const normalized = String(filePath).replace(/\\/g, '/');
      if (normalized.includes('/derivatives/')) {
        res.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
  await app.register(fastifyStatic, {
    // The on-disk layout is public/assets/<...> and the public URL space is
    // /assets/<...> — the root must be the assets folder itself. Pointing it
    // at public/ instead shifted every URL to /assets/assets/<...> and made
    // /assets/logos/* 404 (the bundled gateway/courier logos never loaded).
    root: join(process.cwd(), 'public', 'assets'),
    prefix: '/assets/',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    immutable: true,
    decorateReply: false,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  app.enableCors({
    origin: process.env['CORS_ORIGIN']
      ? process.env['CORS_ORIGIN'].split(',').map((o) => o.trim())
      : [
          'http://localhost:5173',
          'http://localhost:3000',
          'https://mac.riaz.com.bd',
        ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    maxAge: 86400,
  });

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (request, reply) => {
      await clearActiveWriteMarker(String(request.id));
      // Structured access log (Phase 8 Stage 2 item 19). This hook runs
      // outside the middleware ALS scope, so tenant/request ids are read
      // off the raw request/response instead of the mixin: TenantMiddleware
      // stashes tenantId on the raw request, CorrelationIdMiddleware echoes
      // the request id as the x-correlation-id response header.
      const durationMs = Number(reply.elapsedTime.toFixed(0));
      const requestPath = request.url.split(/[?#]/, 1)[0];
      const requestId =
        reply.getHeader('x-correlation-id') || String(request.id);
      const tenantId = (request.raw as { tenantId?: string }).tenantId;
      const rootLogger = PinoLogger.root;
      if (rootLogger) {
        rootLogger.info(
          {
            service: 'backend',
            requestId: String(requestId),
            ...(tenantId ? { tenantId } : {}),
            method: request.method,
            path: requestPath,
            statusCode: reply.statusCode,
            durationMs,
          },
          'request completed',
        );
      } else {
        console.log(
          `${request.method} ${requestPath} ${reply.statusCode} ${durationMs}ms`,
        );
      }
    });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequestAbort', async (request) => {
      await clearActiveWriteMarker(String(request.id));
    });

  app.useGlobalFilters(new GlobalExceptionFilter());
  // /metrics is root-level (outside /api) so the edge never proxies it to
  // tenants; see MetricsController.
  app.setGlobalPrefix('api', {
    exclude: ['/', { path: 'metrics', method: RequestMethod.GET }],
  });

  // Phase 8 Stage 2 item 20: Bull Board queue dashboard (superadmin-only).
  await registerBullBoard(app);

  // Phase 3 central-auth cutover: the Fastify BA hijack that used to
  // live here (main.ts:431-686, the onRequest hook that intercepted
  // /api/better-auth/*, resolved the tenant from Host, and ran the
  // tenant BA handler in-process) is RETIRED. Caddy now proxies
  // /api/better-auth/* to the central auth service on every host, so
  // the hijack has no traffic in the deployed stack — and the frontends
  // are BA-only, so a hijack-level rollback would serve no client.
  // Each of its 13 behaviours (H1-H13) has an explicit new home; the
  // table lives in the Phase 3 evidence
  // (central-auth-phase3-backend-verify/BUILD-SUMMARY.md).

  const port = process.env['PORT'] || 4000;
  await app.listen(port, '0.0.0.0');

  console.log(`Server running on http://localhost:${port}`);
  console.log(
    `[bootstrap] WORKER_MODE=${workerMode} — queue processors ` +
      `${workerMode === 'api' ? 'NOT registered in this process (api mode)' : 'registered'}`,
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
process.on('unhandledRejection', (reason) => {
  console.error(
    '[FATAL] Unhandled Rejection:',
    reason instanceof Error ? reason.message : reason,
  );
});
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error.message);
});
