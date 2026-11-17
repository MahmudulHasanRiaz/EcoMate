import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import { correlationIdStorage } from '../common/middleware/correlation-id.middleware';
import { tenantStorage } from '../tenancy/tenant-context';

/**
 * Phase 8 Stage 2 item 19 — structured, tenant-tagged JSON logging.
 *
 * Every log line carries `tenantId` + `requestId` (the correlation id) via a
 * pino mixin that reads the two AsyncLocalStorage contexts at log time:
 *  - tenantId: set by TenantMiddleware (tenant ALS) for tenant requests.
 *  - requestId: set by CorrelationIdMiddleware from the incoming
 *    `x-correlation-id` header, or a fresh UUID. Also echoed back as the
 *    `x-correlation-id` response header, so a client can hand an operator
 *    the exact id to grep for.
 *
 * Lines logged outside any request (boot, queue workers without tenant
 * context) omit the missing fields rather than logging nulls.
 *
 * The pino logger satisfies Nest's LoggerService interface (nestjs-pino's
 * Logger), and main.ts installs it with app.useLogger(), so the 130+
 * existing `new Logger(X)` call sites keep working unchanged — Nest resolves
 * the delegate at call time (Logger.localInstance is a getter over the
 * static instance ref).
 */

// Never log secrets, even if a service passes a whole object to the logger.
export const LOG_REDACT_PATHS = [
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'clientSecret',
  'mfaSecret',
  'verificationToken',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function logMixin(): Record<string, string> {
  const fields: Record<string, string> = { service: 'backend' };
  const tenantId = tenantStorage.getStore()?.tenantId;
  if (tenantId) fields.tenantId = tenantId;
  const requestId = correlationIdStorage.getStore();
  if (requestId) fields.requestId = requestId;
  return fields;
}

export function logLevel(): string {
  return (
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === 'test' ? 'silent' : 'info')
  );
}

/**
 * pino-http options for nestjs-pino. autoLogging stays OFF: the Fastify
 * onResponse hook in main.ts emits the access log itself, tagged with the
 * tenant/request ids read off the raw request (the hook runs outside the
 * middleware ALS scope, so the mixin cannot see them there).
 */
export function buildPinoHttpOptions(): Params['pinoHttp'] {
  return {
    level: logLevel(),
    autoLogging: false,
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ||
      (req.headers['x-correlation-id'] as string) ||
      randomUUID(),
    mixin: () => logMixin(),
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
  };
}
