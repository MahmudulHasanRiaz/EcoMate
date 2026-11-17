/**
 * Session id for page-view tracking. `crypto.randomUUID()` is only available
 * in secure contexts (HTTPS or localhost) — over plain HTTP on a
 * non-localhost host it is `undefined` and calling it throws, which used to
 * crash checkout (Phase 8 pentest P2). Fall back to a timestamp + random
 * hex id, unique enough for a page-view session id.
 */
export function newSessionId(): string {
  const c = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `pv-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
