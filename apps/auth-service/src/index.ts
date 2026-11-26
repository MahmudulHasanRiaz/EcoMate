// Entry point: load env config, build the auth instance, serve HTTP.
// No framework — plain Node http + Better Auth (spike-proven shape).
import { loadConfig } from './config.js';
import { createAuth } from './auth.js';
import { createServer } from './server.js';
import { closePrisma } from './prisma.js';
import { handoffSweeper } from './impersonation-handoff.js';
import { logger } from './logger.js';

const config = loadConfig();
const { auth, prisma } = createAuth(config);
const server = createServer({ auth, prisma, config });

// Impersonation handoff rows are retained 30 days for audit, then purged
// (design §4.2). Sweep once at boot (after the DB is up) and daily after.
void handoffSweeper(prisma).catch((err: unknown) => {
  logger.warn('auth.impersonation.sweep_failed', {
    error: err instanceof Error ? err.message : String(err),
  });
});
const sweepTimer = setInterval(
  () => {
    void handoffSweeper(prisma).catch((err: unknown) => {
      logger.warn('auth.impersonation.sweep_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  },
  24 * 60 * 60 * 1000,
);
sweepTimer.unref();

server.listen(config.port, config.host, () => {
  logger.info('auth-service.listening', {
    host: config.host,
    port: config.port,
    basePath: '/api/better-auth',
    publicUrl: config.publicUrl,
    organizationLimit: config.organizationLimit,
  });
});

function shutdown(signal: string): void {
  logger.info('auth-service.shutdown', { signal });
  server.close(() => {
    void closePrisma().finally(() => process.exit(0));
  });
  // Force-exit if connections linger.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
