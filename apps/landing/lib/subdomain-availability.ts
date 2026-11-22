/**
 * Live subdomain-availability checks for the signup wizard.
 *
 * Framework-free on purpose: the landing's vitest runs in node with no
 * jsdom or testing-library, so the debounce + sequencing + fetch logic
 * lives here (unit-tested) and the wizard only drives a watcher and
 * renders the statuses it reports.
 *
 * The wizard calls `observe()` only for slugs that already pass the
 * client-side format + reserved checks (see lib/signup-validation.ts);
 * invalid/reserved slugs are answered locally, instantly, with no API
 * call. Submit stays the authority: a `taken` answer blocks Next/submit,
 * but `checking` / `error` / `rate-limited` never do.
 */

export type SubdomainAvailabilityReason =
  | 'available'
  | 'taken'
  | 'invalid-format'
  | 'reserved';

export interface SubdomainAvailabilityResponse {
  slug: string;
  available: boolean;
  reason: SubdomainAvailabilityReason;
}

export type AvailabilityStatus =
  | { state: 'idle' }
  | { state: 'checking'; slug: string }
  | { state: 'available'; slug: string }
  | { state: 'taken'; slug: string }
  | { state: 'error'; slug: string }
  | { state: 'rate-limited'; slug: string };

export const SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS = 500;

export const SUBDOMAIN_TAKEN_MESSAGE =
  'This store address is already taken. Try another.';
export const SUBDOMAIN_CHECK_FAILED_MESSAGE =
  'Could not check availability — you can continue; we will confirm at signup.';

/** Minimal fetch surface the watcher needs (tests inject a stub). */
export type AvailabilityFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReason(value: unknown): value is SubdomainAvailabilityReason {
  return (
    value === 'available' ||
    value === 'taken' ||
    value === 'invalid-format' ||
    value === 'reserved'
  );
}

function parseAvailability(
  data: unknown,
  requestedSlug: string,
): AvailabilityStatus {
  if (
    isRecord(data) &&
    typeof data.slug === 'string' &&
    typeof data.available === 'boolean' &&
    isReason(data.reason)
  ) {
    // A mismatched echo is a stale/wrong answer — never apply it.
    if (data.slug !== requestedSlug) {
      return { state: 'error', slug: requestedSlug };
    }
    if (data.available) return { state: 'available', slug: requestedSlug };
    if (data.reason === 'taken') return { state: 'taken', slug: requestedSlug };
    // invalid-format / reserved should never reach here — the wizard only
    // calls for locally-valid slugs. If the server disagrees (lists
    // drifted), treat it as a failed check, never as a block: submit is
    // the authority.
    return { state: 'error', slug: requestedSlug };
  }
  return { state: 'error', slug: requestedSlug };
}

/**
 * Debounced availability watcher. Call `observe(slug)` on every slug
 * change (or `null` when the slug is not locally valid / empty).
 *
 * - Waits 500 ms after the last change before calling the API.
 * - Aborts the in-flight request on the next change (nicety); the
 *   correctness guarantee is sequencing — a response is applied ONLY if
 *   its slug still equals the current field value.
 */
export class SubdomainAvailabilityWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private currentSlug: string | null = null;
  private disposed = false;

  constructor(
    private readonly onStatus: (status: AvailabilityStatus) => void,
    // Wrapper, not a bare `fetch` reference: calling the global fetch
    // detached from its Window (`const f = fetch; f(url)`) throws
    // "Illegal invocation" in browsers — the request never fires.
    private readonly fetchImpl: AvailabilityFetch = (input, init) =>
      fetch(input, init),
    private readonly debounceMs: number = SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS,
  ) {}

  observe(slug: string | null): void {
    if (this.disposed) return;
    this.currentSlug = slug;
    this.clearTimer();
    this.inflight?.abort();
    this.inflight = null;
    if (!slug) {
      this.onStatus({ state: 'idle' });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check(slug);
    }, this.debounceMs);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.inflight?.abort();
    this.inflight = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async check(slug: string): Promise<void> {
    if (this.disposed || this.currentSlug !== slug) return;
    const controller = new AbortController();
    this.inflight = controller;
    this.onStatus({ state: 'checking', slug });
    let status: AvailabilityStatus;
    try {
      const response = await this.fetchImpl(
        `/api/public/signup/subdomain-availability?slug=${encodeURIComponent(slug)}`,
        { signal: controller.signal },
      );
      if (response.status === 429) {
        status = { state: 'rate-limited', slug };
      } else if (!response.ok) {
        status = { state: 'error', slug };
      } else {
        const data = await response.json().catch(() => null);
        status = parseAvailability(data, slug);
      }
    } catch {
      // Aborted by a newer keystroke (or dispose): stay silent — the
      // newer check owns the UI now. Any other failure is a failed check.
      if (controller.signal.aborted || this.disposed) return;
      status = { state: 'error', slug };
    }
    // Stale-result discipline: apply only if the slug is still current.
    if (this.disposed || this.currentSlug !== slug) return;
    if (this.inflight === controller) this.inflight = null;
    this.onStatus(status);
  }
}
