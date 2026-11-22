import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS,
  SubdomainAvailabilityWatcher,
  type AvailabilityFetch,
  type AvailabilityStatus,
} from '../subdomain-availability';

function jsonResponse(
  body: unknown,
  status = 200,
): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeWatcher(fetchImpl: AvailabilityFetch) {
  const statuses: AvailabilityStatus[] = [];
  const watcher = new SubdomainAvailabilityWatcher(
    (status) => statuses.push(status),
    fetchImpl,
  );
  return { watcher, statuses };
}

describe('SubdomainAvailabilityWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: no call before 500 ms, exactly one call after', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ slug: 'acme', available: true, reason: 'available' }),
    );
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(
      SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS - 1,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/public/signup/subdomain-availability?slug=acme',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(statuses).toContainEqual({ state: 'checking', slug: 'acme' });
    expect(statuses).toContainEqual({ state: 'available', slug: 'acme' });
    watcher.dispose();
  });

  it('restarts the debounce on every keystroke (one call for a burst)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ slug: 'acme-store', available: true, reason: 'available' }),
    );
    const { watcher } = makeWatcher(fetchImpl);
    watcher.observe('a');
    await vi.advanceTimersByTimeAsync(300);
    watcher.observe('ac');
    await vi.advanceTimersByTimeAsync(300);
    watcher.observe('acme-store');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('slug=acme-store'),
      expect.anything(),
    );
    watcher.dispose();
  });

  it('reports taken for a taken slug', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ slug: 'acme', available: false, reason: 'taken' }),
    );
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(statuses).toContainEqual({ state: 'taken', slug: 'acme' });
    watcher.dispose();
  });

  it('resets to idle and cancels the pending check on observe(null)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ slug: 'acme', available: true, reason: 'available' }),
    );
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(200);
    watcher.observe(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toEqual({ state: 'idle' });
    watcher.dispose();
  });

  it('discards a stale response when the field changed mid-flight', async () => {
    let resolveFirst: (value: ReturnType<typeof jsonResponse>) => void;
    const first = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(
        jsonResponse({ slug: 'beta', available: true, reason: 'available' }),
      );
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    // User kept typing while the first request was in flight.
    watcher.observe('beta');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    // The slow first response finally arrives — it must be ignored.
    resolveFirst!(
      jsonResponse({ slug: 'acme', available: true, reason: 'available' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).not.toContainEqual({ state: 'available', slug: 'acme' });
    expect(statuses).toContainEqual({ state: 'available', slug: 'beta' });
    watcher.dispose();
  });

  it('aborts the in-flight request on the next keystroke', async () => {
    const signals: AbortSignal[] = [];
    // A hanging fetch: still in flight when the next keystroke lands.
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<{
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      }>(() => undefined);
    });
    const { watcher } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    watcher.observe('beta');
    expect(signals[0]?.aborted).toBe(true);
    watcher.dispose();
  });

  it('reports rate-limited on 429', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'slow down' }, 429));
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(statuses).toContainEqual({ state: 'rate-limited', slug: 'acme' });
    watcher.dispose();
  });

  it('reports error on network failure and on non-OK responses', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    const { watcher: w1, statuses: s1 } = makeWatcher(failing);
    w1.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(s1).toContainEqual({ state: 'error', slug: 'acme' });
    w1.dispose();

    const serverError = vi.fn(async () => jsonResponse({}, 500));
    const { watcher: w2, statuses: s2 } = makeWatcher(serverError);
    w2.observe('beta');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(s2).toContainEqual({ state: 'error', slug: 'beta' });
    w2.dispose();
  });

  it('reports error on a malformed body or a mismatched slug echo', async () => {
    const malformed = vi.fn(async () => jsonResponse({ nope: true }));
    const { watcher: w1, statuses: s1 } = makeWatcher(malformed);
    w1.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(s1).toContainEqual({ state: 'error', slug: 'acme' });
    w1.dispose();

    const mismatched = vi.fn(async () =>
      jsonResponse({ slug: 'other', available: true, reason: 'available' }),
    );
    const { watcher: w2, statuses: s2 } = makeWatcher(mismatched);
    w2.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(s2).toContainEqual({ state: 'error', slug: 'acme' });
    w2.dispose();
  });

  it('treats a server invalid-format/reserved answer as a failed check, never a block', async () => {
    // The wizard only calls for locally-valid slugs, so these should not
    // happen; if the lists ever drift, submit stays the authority.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ slug: 'acme', available: false, reason: 'reserved' }),
    );
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
    expect(statuses).toContainEqual({ state: 'error', slug: 'acme' });
    expect(statuses).not.toContainEqual({ state: 'taken', slug: 'acme' });
    watcher.dispose();
  });

  it('stays silent after dispose', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ slug: 'acme', available: true, reason: 'available' }),
    );
    const { watcher, statuses } = makeWatcher(fetchImpl);
    watcher.observe('acme');
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
  });

  it('uses the global fetch by default (no injected fetch)', async () => {
    // The default fetchImpl is a wrapper that calls the global `fetch`
    // as a bare global call — NOT a stored bare reference, which throws
    // "Illegal invocation" in browsers (fetch needs Window as `this`)
    // and silently fails every check (found by the live browser probe).
    // Vitest/Node cannot reproduce browser global-`this` semantics, so
    // this test proves the default wiring reaches the global fetch; the
    // browser probe proves the binding in a real browser.
    const stub = vi.fn(async () =>
      jsonResponse({ slug: 'acme', available: true, reason: 'available' }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      const statuses: AvailabilityStatus[] = [];
      const watcher = new SubdomainAvailabilityWatcher((status) =>
        statuses.push(status),
      );
      watcher.observe('acme');
      await vi.advanceTimersByTimeAsync(SUBDOMAIN_AVAILABILITY_DEBOUNCE_MS);
      expect(stub).toHaveBeenCalledWith(
        '/api/public/signup/subdomain-availability?slug=acme',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(statuses).toContainEqual({ state: 'available', slug: 'acme' });
      watcher.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
