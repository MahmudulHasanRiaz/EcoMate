import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import { getRequestId } from './request-context';

/**
 * Phase 8 Stage 2 item 19 — structured JSON logging for the platform API.
 * Every line carries `requestId` (from RequestIdMiddleware's ALS) and
 * `service`. The platform API has no tenant ALS — platform requests are
 * operator-scoped, not tenant-scoped — so there is no tenantId field here;
 * tenant ids appear in message payloads where a job acts on a tenant.
 *
 * Installed via app.useLogger() in main.ts, so the existing
 * `new Logger(X)` call sites keep working unchanged.
 */
export const LOG_REDACT_PATHS = [
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'tempPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'mfaSecret',
  'verificationToken',
  'inviteToken',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function logMixin(): Record<string, string> {
  const fields: Record<string, string> = { service: 'platform-api' };
  const requestId = getRequestId();
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
 * autoLogging stays OFF: the Fastify onResponse hook in main.ts emits the
 * access log itself (the hook runs outside the middleware ALS scope, so it
 * reads the request id off the raw request instead of the mixin).
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
