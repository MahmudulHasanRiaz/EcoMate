/**
 * Navigation seam for code that must redirect or reload the page outside
 * React (session-expiry bounce, org switching, impersonation stop).
 *
 * `window.location.assign` / `reload` are non-configurable on the
 * Location object in Chromium, so tests cannot spy on them directly —
 * they spy on this plain object's methods instead. This lives in its own
 * module (not in `api-client`) on purpose: many test files mock
 * `@/lib/api-client` with a partial mock, and a named import of the seam
 * from there breaks every file whose component tree transitively imports
 * it.
 */
export const sessionRedirect = {
  assign: (url: string) => window.location.assign(url),
  reload: () => window.location.reload(),
}
