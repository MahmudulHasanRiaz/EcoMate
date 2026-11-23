/**
 * Worker-mode split — webhook fix workstream E (Phase 9, P1 "separate worker
 * service(s)", analysis §4.5/§7).
 *
 * One backend image, two processes:
 *   - `api`    — HTTP + schedulers; queue processors NOT registered.
 *   - `worker` — queue processors only; no HTTP listen, schedulers NOT
 *     registered.
 *   - `all`    — everything (today's behaviour; the default, used by tests
 *     and local dev unless the flag says otherwise).
 *
 * The mode gates REGISTRATION, not execution:
 *   - Processor classes are left out of their module's `providers` in `api`
 *     mode, so @nestjs/bullmq never creates a BullMQ Worker for them.
 *   - Scheduler bootstrap hooks (BullMQ repeatable registration, poll
 *     loops) early-return in `worker` mode.
 *   - Queue producer registration (BullModule.registerQueue) is NEVER
 *     gated — the API must still enqueue from HTTP handlers.
 *
 * Pure functions over an explicit env record (same pattern as
 * stores/store-flags.ts) so they are unit-testable without a database.
 * No caching: process.env is re-read on every call, so a test that changes
 * the env and re-requires a module file sees the new mode.
 */

export type WorkerMode = 'all' | 'api' | 'worker';

export const WORKER_MODE_ENV_KEY = 'WORKER_MODE';
export const WORKER_MODE_DEFAULT: WorkerMode = 'all';

const VALID_MODES: ReadonlySet<string> = new Set(['all', 'api', 'worker']);

let warnedInvalid = false;

/**
 * Parse WORKER_MODE. Missing/empty resolves to 'all' (today's behaviour).
 * An unknown value also resolves to 'all' with a one-time warning — a typo
 * must never silently stop processors or schedulers in production (same
 * fail-open philosophy as the store runtime flags).
 */
export function parseWorkerMode(
  env: Record<string, string | undefined> = process.env,
): WorkerMode {
  const raw = env[WORKER_MODE_ENV_KEY];
  if (raw === undefined) return WORKER_MODE_DEFAULT;
  const value = raw.trim().toLowerCase();
  if (value === '') return WORKER_MODE_DEFAULT;
  if (VALID_MODES.has(value)) return value as WorkerMode;
  if (!warnedInvalid) {
    warnedInvalid = true;
    console.warn(
      `[worker-mode] Invalid WORKER_MODE=${JSON.stringify(raw)} — falling back to 'all'. ` +
        `Valid values: all | api | worker.`,
    );
  }
  return WORKER_MODE_DEFAULT;
}

/** Queue processors (@Processor classes) are registered in this mode. */
export function processorsEnabled(
  mode: WorkerMode = parseWorkerMode(),
): boolean {
  return mode !== 'api';
}

/** Schedulers (repeatable registration + poll loops) run in this mode. */
export function schedulersEnabled(
  mode: WorkerMode = parseWorkerMode(),
): boolean {
  return mode !== 'worker';
}

/**
 * This process serves HTTP. Entrypoint-level: main.ts listens, worker.main.ts
 * does not — the entrypoints fail fast when the mode contradicts them, so
 * this predicate is the contract both sides share (and the smoke test asserts).
 */
export function httpEnabled(mode: WorkerMode = parseWorkerMode()): boolean {
  return mode !== 'worker';
}
