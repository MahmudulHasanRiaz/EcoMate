import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request id context for the platform API (the backend already has
 * correlationIdStorage; the platform API had no request-id middleware, so
 * this is its equivalent). Set by RequestIdMiddleware from the incoming
 * `x-request-id` / `x-correlation-id` header, or a fresh UUID; echoed back
 * as the `x-request-id` response header. The pino mixin reads it so every
 * log line carries the id.
 */
export const requestIdStorage = new AsyncLocalStorage<string>();

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore();
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}
