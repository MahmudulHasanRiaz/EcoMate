import { create } from 'zustand'

/**
 * Tenant auth state — Phase 3 central Better Auth cutover.
 *
 * The BA session cookie (httpOnly, set by the central service via the
 * same-origin `/api/better-auth/*` proxy) is the ONLY credential now.
 * There is no access token in a JS-readable cookie, no user JSON in
 * localStorage, and no `/auth/me` prefetch cache anymore:
 *
 * - `isSignedIn` / `impersonatedBy` come from `authClient.useSession()`
 *   (synced by the authenticated layout's session bridge);
 * - `user` is the TENANT profile (role, permissions, first/last name)
 *   fetched once per session from the backend `GET /auth/me`, which the
 *   backend guard enriches from the central session. The central service
 *   deliberately carries no tenant role or permissions on the session user
 *   (see `apps/auth-service/src/auth-options.ts` — no `customSession`, only
 *   the console `platformRole` additional field), so `/auth/me` cannot be
 *   deleted outright; the 5-minute keepalive poll around it is gone,
 *   because the BA session refreshes server-side (`updateAge`).
 */
export interface AuthUser {
  id: string
  email: string
  role: string
  permissions: string[]
  /** From /auth/me — the account holder's own profile name. */
  firstName?: string
  lastName?: string
  username?: string
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    /** True while a live BA session exists (set by the session bridge). */
    isSignedIn: boolean
    setSignedIn: (signedIn: boolean) => void
    /**
     * Central user id of the platform operator when this session is an
     * impersonated one (`session.impersonatedBy`, D8). `null` otherwise.
     */
    impersonatedBy: string | null
    setImpersonatedBy: (actorId: string | null) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    setUser: (user) => {
      // The BA session user has no `permissions` key — normalise so every
      // consumer reads an array and never `undefined`.
      const next = user
        ? { ...user, permissions: user.permissions || [] }
        : user
      set((state) => ({ ...state, auth: { ...state.auth, user: next } }))
    },
    isSignedIn: false,
    setSignedIn: (isSignedIn) =>
      set((state) => ({ ...state, auth: { ...state.auth, isSignedIn } })),
    impersonatedBy: null,
    setImpersonatedBy: (impersonatedBy) =>
      set((state) => ({ ...state, auth: { ...state.auth, impersonatedBy } })),
    reset: () =>
      set((state) => ({
        ...state,
        auth: { ...state.auth, user: null, isSignedIn: false, impersonatedBy: null },
      })),
  },
}))
