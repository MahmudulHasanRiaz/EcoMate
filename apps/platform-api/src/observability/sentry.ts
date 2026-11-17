import * as Sentry from '@sentry/node';

/**
 * Phase 8 Stage 2 item 20 — Sentry error tracking, wired but inert until a
 * real DSN is configured (Boss budget decision F3). With SENTRY_DSN unset,
 * empty, or a placeholder value, initSentry() is a no-op and
 * Sentry.captureException() elsewhere is a safe no-op (the SDK tolerates
 * capture calls before init). No account is created and no spend happens
 * from this code alone.
 */
export function resolveSentryDsn(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (value.includes('placeholder')) return undefined;
  // The documented example DSN from Sentry's own docs — never a real project.
  if (value === 'https://public@o0.ingest.sentry.io/0') return undefined;
  return value;
}

/** Initialise Sentry when a real DSN is configured. Returns true if enabled. */
export function initSentry(service: string): boolean {
  const dsn = resolveSentryDsn(process.env.SENTRY_DSN);
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    serverName: service,
    // Error tracking only for the MVP; tracing stays off (cost + overhead).
    tracesSampleRate: 0,
  });
  return true;
}

/** Capture an error when Sentry is enabled; a no-op otherwise. Never throws. */
export function captureError(error: unknown): void {
  try {
    Sentry.captureException(error);
  } catch {
    // Error reporting must never break the request it reports on.
  }
}
