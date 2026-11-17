import { Controller, Get, Logger, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { Public } from '../common/decorators/public.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { SkipTenant } from '../tenancy/skip-tenant.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { QueueHealthService, type QueueHealth } from './queue-health.service';

/** Per-check budget: a hung dependency must not hang the probe. */
const CHECK_TIMEOUT_MS = 2_000;

interface DependencyChecks {
  database: 'ok' | 'failed';
  redis: 'ok' | 'failed' | 'unconfigured';
  queues: QueueHealth[];
  queuesOk: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('check timed out')), ms),
    ),
  ]);
}

/**
 * Health endpoints — liveness vs readiness split (Phase 8).
 *
 * - `GET /health/live` — liveness: the process is up. Never touches a
 *   dependency, always 200. Use for container liveness / restart probes.
 * - `GET /health/ready` — readiness: the instance can serve traffic.
 *   Checks the database, Redis, and every BullMQ queue. 200 when ready,
 *   503 when any check fails. Use for load-balancer / orchestrator
 *   readiness and for deploy gates.
 * - `GET /health` — aggregate (backward compatible): the same checks as
 *   readiness, always 200, with `status: healthy | degraded` in the body.
 *   Existing compose healthchecks and monitors hit this endpoint.
 *
 * Redis "unconfigured" (no REDIS_URL/REDIS_HOST, memory fallback) is
 * reported honestly but does NOT fail readiness — the cache degrades to
 * memory by design. A configured-but-down Redis DOES fail readiness:
 * rate limiting, queues, and the shared cache all depend on it.
 */
@RateLimitPolicy('health')
@SkipTenant()
@SkipSubscription()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly queues: QueueHealthService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Public()
  @Get('ready')
  async ready(@Res() res: FastifyReply) {
    const checks = await this.runChecks();
    const ready =
      checks.database === 'ok' &&
      checks.redis !== 'failed' &&
      checks.queuesOk;
    const body = {
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: checks.database,
        redis: checks.redis,
        queues: checks.queues,
      },
    };
    return res.status(ready ? 200 : 503).send(body);
  }

  @Public()
  @Get()
  async check() {
    const checks = await this.runChecks();
    const healthy =
      checks.database === 'ok' &&
      checks.redis !== 'failed' &&
      checks.queuesOk;
    return {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: checks.database,
        redis: checks.redis,
        queues: checks.queues,
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
    };
  }

  private async runChecks(): Promise<DependencyChecks> {
    const [dbOk, redis, queueResult] = await Promise.all([
      withTimeout(this.prisma.$queryRawUnsafe('SELECT 1'), CHECK_TIMEOUT_MS)
        .then(() => true)
        .catch((err) => {
          this.logger.error(`Health check DB ping failed: ${err.message}`);
          return false;
        }),
      withTimeout(this.cache.ping(), CHECK_TIMEOUT_MS).catch(() => false),
      this.queues.check().catch((err) => {
        this.logger.error(`Health check queue probe failed: ${err.message}`);
        return { ok: false, queues: [] as QueueHealth[] };
      }),
    ]);

    return {
      database: dbOk ? 'ok' : 'failed',
      redis: this.redisConfigured()
        ? redis
          ? 'ok'
          : 'failed'
        : 'unconfigured',
      queues: queueResult.queues,
      queuesOk: queueResult.ok,
    };
  }

  private redisConfigured(): boolean {
    return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
  }
}
