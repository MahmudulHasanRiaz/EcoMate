import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'
import { sessionRedirect } from './session-redirect'

export { sessionRedirect } from './session-redirect'

/**
 * Tenant API client — Phase 3 central Better Auth cutover.
 *
 * Auth is the BA session cookie now (httpOnly, set by the central service
 * via the same-origin `/api/better-auth/*` proxy, sent with
 * `withCredentials`). There is NO Bearer token anymore, and NO refresh
 * machinery: the BA session refreshes server-side (`updateAge`), so a 401
 * means the session is gone and the user signs in again. The interceptor
 * therefore resets local auth state and redirects once — it never replays
 * the request.
 */

function resolveApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  return '/api'
}

const API_BASE_URL = resolveApiUrl()

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * Sign-in redirect used when a session has expired.
 * `expired=1` lets the sign-in page surface a friendly "session expired"
 * banner instead of a silent bounce. The current admin route is preserved
 * (stripped of the /admin base) so the user can return after logging in.
 */
export function buildSessionExpiredRedirect(pathname: string, search: string): string {
  let returnPath = pathname + search
  if (returnPath.startsWith('/admin/')) {
    returnPath = '/' + returnPath.slice(7)
  }
  const returnUrl = encodeURIComponent(returnPath)
  return `/admin/sign-in?redirect=${returnUrl}&expired=1`
}

/**
 * Public auth pages: unauthenticated by design. A 401 here (e.g. a
 * background entitlements fetch while logged out) is NOT a session
 * expiring — there is no session. The interceptor must never bounce the
 * user off these pages to sign-in. The OTP page is gone (D7=B: BA native
 * reset links replace the OTP flow), so `/otp` is no longer listed.
 */
const PUBLIC_AUTH_PATHS = new Set([
  '/sign-in',
  '/sign-in-2',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
])

export function isPublicAuthPath(pathname: string): boolean {
  let path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/admin') path = '/'
  else if (path.startsWith('/admin/')) path = path.slice('/admin'.length)
  return PUBLIC_AUTH_PATHS.has(path)
}

/**
 * Only redirect on an expired session when there WAS an authenticated session.
 * A bare 401 with no session while already on the sign-in page is just a failed
 * anonymous call — bouncing there again would loop forever. And a 401 on any
 * public auth page is never a session expiring (see isPublicAuthPath).
 */
export function shouldRedirectOnSessionExpiry(isSignedIn: boolean, pathname: string): boolean {
  if (isPublicAuthPath(pathname)) return false
  return isSignedIn || pathname !== '/admin/sign-in'
}

apiClient.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    if (config.headers) {
      delete config.headers['Content-Type']
      delete config.headers['content-type']
    }
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Only handle 401 responses
    if (error.response?.status !== 401) {
      return Promise.reject(error)
    }

    // If this request was already handled, give up (no replay: there is no
    // client-side refresh under BA — a 401 means the session is gone).
    if (originalRequest._retry) {
      return Promise.reject(error)
    }
    originalRequest._retry = true

    // Clear auth (user + session flag) so any other in-flight request /
    // protected UI sees a logged-out state immediately.
    const wasSignedIn = useAuthStore.getState().auth.isSignedIn
    useAuthStore.getState().auth.reset()

    // Attach ?expired=1 so the sign-in page can show a "session expired" banner.
    if (shouldRedirectOnSessionExpiry(wasSignedIn, window.location.pathname)) {
      sessionRedirect.assign(
        buildSessionExpiredRedirect(window.location.pathname, window.location.search),
      )
    }
    return Promise.reject(error)
  },
)
