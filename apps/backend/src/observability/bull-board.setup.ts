import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyRequest } from 'fastify';
import type { Queue } from 'bullmq';
import { OBSERVED_QUEUES } from './queues';

export const BULL_BOARD_BASE_PATH = '/api/admin/queues';

const logger = new Logger('BullBoard');

/**
 * Phase 8 Stage 2 item 20 — Bull Board queue dashboard for the 10 BullMQ
 * queues, mounted at /api/admin/queues (under /api so the edge routes it
 * to the backend, not the admin SPA).
 *
 * Auth: Bull Board registers raw Fastify routes, so Nest guards never see
 * them. The plugin is mounted inside an encapsulated Fastify context with
 * an onRequest hook that verifies the tenant access JWT (same secret and
 * `role` claim the JwtStrategy/RolesGuard use) and requires
 * role === 'superadmin'. No token or a non-superadmin role gets 403.
 * Impersonated tokens (imp: true) are NOT accepted: queue ops must come
 * from a real operator session, not an impersonation.
 *
 * Returns true when the board mounted, false when disabled or when no
 * queue could be resolved (boot continues — the board is observability,
 * not a boot dependency — but the miss is logged as an error).
 */
export async function registerBullBoard(
  app: INestApplication,
): Promise<boolean> {
  if (process.env.BULL_BOARD_ENABLED === 'false') {
    logger.log('Bull Board disabled (BULL_BOARD_ENABLED=false)');
    return false;
  }
  const queues: Array<{ name: string; queue: Queue }> = [];
  for (const name of OBSERVED_QUEUES) {
    try {
      const queue = app.get<Queue>(getQueueToken(name), { strict: false });
      if (queue) queues.push({ name, queue });
    } catch {
      // Missing queue: reported below.
    }
  }
  if (queues.length === 0) {
    logger.error(
      'Bull Board NOT mounted: no BullMQ queue could be resolved from the application context',
    );
    return false;
  }
  if (queues.length < OBSERVED_QUEUES.length) {
    const missing = OBSERVED_QUEUES.filter(
      (name) => !queues.some((entry) => entry.name === name),
    );
    logger.warn(`Bull Board mounted without queues: ${missing.join(', ')}`);
  }

  let jwt: JwtService;
  try {
    jwt = app.get(JwtService);
  } catch {
    logger.error(
      'Bull Board NOT mounted: JwtService is unavailable, so the superadmin guard cannot verify tokens',
    );
    return false;
  }

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);
  createBullBoard({
    queues: queues.map(
      ({ queue }) => new BullMQAdapter(queue),
    ),
    serverAdapter,
  });

  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(async (instance) => {
    instance.addHook('onRequest', async (request, reply) => {
      if (!(await isSuperadminRequest(request, jwt))) {
        return reply
          .code(403)
          .send({ statusCode: 403, message: 'Forbidden' });
      }
    });
    // The prefix is load-bearing: registerPlugin() registers the entry
    // route at `/` and the API at `/api/queues` RELATIVE to the plugin
    // prefix. Without it the board mounts at the app root (shadowing `/`
    // and leaking the dashboard path) instead of /api/admin/queues.
    await instance.register(serverAdapter.registerPlugin(), {
      prefix: BULL_BOARD_BASE_PATH,
    });
  });
  logger.log(
    `Bull Board mounted at ${BULL_BOARD_BASE_PATH} (${queues.length} queues, superadmin-only)`,
  );
  return true;
}

/** Verify a Bearer tenant JWT and require role superadmin (never impersonated). */
export async function isSuperadminRequest(
  request: FastifyRequest,
  jwt: JwtService,
): Promise<boolean> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  try {
    const payload = await jwt.verifyAsync<{
      role?: string;
      imp?: boolean;
    }>(header.slice('Bearer '.length), { secret });
    if (payload?.imp === true) return false;
    return payload?.role === 'superadmin';
  } catch {
    return false;
  }
}
