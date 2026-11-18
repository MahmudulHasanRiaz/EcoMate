/**
 * Platform API health for the account menu (StackMate "Status — All OK"
 * pill). One health check per session, cached at module level so every
 * mount of the account menu shares it. Honest values only: the caller
 * reports "checking" until this settles, then true (HTTP 2xx) or false
 * (anything else, including a network failure).
 */

let healthPromise: Promise<boolean> | null = null;

/**
 * Run the health check once per session. `check` performs the actual
 * request (the account menu passes a call to the authenticated `api`
 * helper); concurrent callers share the same in-flight promise, and
 * later callers reuse the settled result.
 */
export function fetchApiHealth(
  check: () => Promise<boolean>,
): Promise<boolean> {
  if (!healthPromise) {
    healthPromise = check().catch(() => false);
  }
  return healthPromise;
}

/** Test-only: drop the cached result so a fresh check runs. */
export function resetApiHealthCache(): void {
  healthPromise = null;
}
