import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError } from 'axios'
import {
  apiClient,
  buildSessionExpiredRedirect,
  isPublicAuthPath,
  shouldRedirectOnSessionExpiry,
  sessionRedirect,
} from './api-client'
import { useAuthStore } from '@/stores/auth-store'

function unauthorized(config: any): never {
  throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, config, {
    status: 401,
    statusText: 'Unauthorized',
    data: { message: 'Authentication required' },
    headers: {},
    config,
  } as any)
}

/**
 * Phase 3: there is no refresh machinery anymore — the BA session cookie
 * is the credential and it refreshes server-side. A 401 means the session
 * is gone: the interceptor resets local auth state and redirects once to
 * sign-in. It never replays the request and never calls `/auth/refresh`.
 *
 * The `sessionRedirect.assign` spy is installed in beforeEach for EVERY
 * test in this file: the real `window.location.assign` would navigate the
 * vitest browser iframe away from the test page and kill the whole run
 * (the as-found baseline died exactly this way — 79 files never ran).
 */
describe('apiClient 401 handling (Phase 3)', () => {
  let assignSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    useAuthStore.getState().auth.reset()
    vi.restoreAllMocks()
    assignSpy = vi
      .spyOn(sessionRedirect, 'assign')
      .mockImplementation(() => {})
    apiClient.defaults.adapter = async (config) => unauthorized(config) as never
  })

  afterEach(() => {
    assignSpy.mockRestore()
  })

  it('resets auth and redirects once on a 401, without replaying the request', async () => {
    const postSpy = vi.spyOn(axios, 'post')
    useAuthStore.getState().auth.setSignedIn(true)
    useAuthStore
      .getState()
      .auth.setUser({ id: '1', email: 'a@b.c', role: 'admin', permissions: [] })
    let adapterCalls = 0
    apiClient.defaults.adapter = async (config) => {
      adapterCalls += 1
      return unauthorized(config) as never
    }
    const resetSpy = vi.spyOn(useAuthStore.getState().auth, 'reset')
    const originalUrl = window.location.pathname + window.location.search
    window.history.pushState({}, '', '/admin/op/orders')

    try {
      await expect(apiClient.get('/protected/resource')).rejects.toBeTruthy()
      expect(adapterCalls).toBe(1)
      expect(postSpy).not.toHaveBeenCalled()
      expect(resetSpy).toHaveBeenCalled()
      expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
      expect(assignSpy).toHaveBeenCalledWith(
        expect.stringContaining('expired=1'),
      )
    } finally {
      window.history.pushState({}, '', originalUrl)
    }
  })

  it('never calls /auth/refresh on a 401', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} } as any)
    await expect(apiClient.get('/a')).rejects.toBeTruthy()
    await expect(apiClient.get('/b')).rejects.toBeTruthy()
    // Two DISTINCT 401s: no refresh is attempted for either.
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('does NOT redirect on a 401 from a public auth page', async () => {
    const originalUrl = window.location.pathname + window.location.search
    window.history.pushState({}, '', '/admin/forgot-password?email=a@b.com')

    try {
      await expect(apiClient.get('/entitlements/me')).rejects.toBeTruthy()
      // Auth is still cleared — only the bounce is suppressed.
      expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
      expect(assignSpy).not.toHaveBeenCalled()
    } finally {
      window.history.pushState({}, '', originalUrl)
    }
  })

  it('does NOT redirect when already on the sign-in page with no session', async () => {
    const originalUrl = window.location.pathname + window.location.search
    window.history.pushState({}, '', '/admin/sign-in')

    try {
      await expect(apiClient.get('/entitlements/me')).rejects.toBeTruthy()
      expect(assignSpy).not.toHaveBeenCalled()
    } finally {
      window.history.pushState({}, '', originalUrl)
    }
  })

  it('redirects with expired=1 from an authenticated page', async () => {
    const originalUrl = window.location.pathname + window.location.search
    window.history.pushState({}, '', '/admin/op/orders')

    try {
      await expect(apiClient.get('/hr/anything')).rejects.toBeTruthy()
      expect(assignSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\/admin\/sign-in\?/),
      )
      expect(assignSpy).toHaveBeenCalledWith(
        expect.stringContaining('expired=1'),
      )
    } finally {
      window.history.pushState({}, '', originalUrl)
    }
  })

  it('lets non-401 errors propagate without resetting or redirecting', async () => {
    // A custom axios adapter settles itself: a 500 must REJECT (the
    // built-in adapters do this via validateStatus; a custom one that
    // resolves a 500 response would look like success).
    apiClient.defaults.adapter = (async (config: any) => {
      throw new AxiosError('Server Error', 'ERR_BAD_RESPONSE', config, config, {
        status: 500,
        statusText: 'Server Error',
        data: {},
        headers: {},
        config,
      } as any)
    }) as any
    useAuthStore.getState().auth.setSignedIn(true)
    await expect(apiClient.get('/x')).rejects.toBeTruthy()
    expect(useAuthStore.getState().auth.isSignedIn).toBe(true)
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('builds a sign-in redirect URL that preserves the request path and marks expired', () => {
    expect(buildSessionExpiredRedirect('/admin/op/orders?page=2', '')).toBe(
      '/admin/sign-in?redirect=%2Fop%2Forders%3Fpage%3D2&expired=1',
    )
    expect(buildSessionExpiredRedirect('/admin/sign-in', '?expired=1')).toContain('expired=1')
  })
})

describe('apiClient session expiry helpers (Phase 3)', () => {
  it('redirects only when a session was authenticated or the user is not on the sign-in page', () => {
    expect(shouldRedirectOnSessionExpiry(true, '/admin/op/orders')).toBe(true)
    expect(shouldRedirectOnSessionExpiry(false, '/admin/op/orders')).toBe(true)
    // No session + already on the sign-in page → a failed anonymous call, no bounce.
    expect(shouldRedirectOnSessionExpiry(false, '/admin/sign-in')).toBe(false)
  })

  it('never redirects from a public auth page, with or without a session', () => {
    // A 401 on a public auth page is not a session expiring — there is no
    // session. The OTP page is gone (D7=B: BA native reset links replace
    // the OTP flow), so `/otp` is NOT public anymore.
    for (const path of [
      '/admin/sign-in',
      '/admin/sign-in-2',
      '/admin/sign-up',
      '/admin/forgot-password',
      '/admin/reset-password',
    ]) {
      expect(shouldRedirectOnSessionExpiry(false, path)).toBe(false)
      expect(shouldRedirectOnSessionExpiry(true, path)).toBe(false)
    }
    expect(shouldRedirectOnSessionExpiry(false, '/admin/otp')).toBe(true)
  })

  it('still redirects from authenticated pages, with or without a session', () => {
    expect(shouldRedirectOnSessionExpiry(true, '/admin/op/orders')).toBe(true)
    expect(shouldRedirectOnSessionExpiry(false, '/admin/op/orders')).toBe(true)
    expect(shouldRedirectOnSessionExpiry(true, '/admin/')).toBe(true)
    expect(shouldRedirectOnSessionExpiry(false, '/admin/')).toBe(true)
  })

  it('isPublicAuthPath normalises the /admin basepath and trailing slashes', () => {
    // The OTP page is gone (D7=B) — it is no longer a public auth path.
    expect(isPublicAuthPath('/admin/otp')).toBe(false)
    expect(isPublicAuthPath('/otp')).toBe(false)
    expect(isPublicAuthPath('/admin/forgot-password')).toBe(true)
    expect(isPublicAuthPath('/forgot-password/')).toBe(true)
    expect(isPublicAuthPath('/reset-password')).toBe(true)
    expect(isPublicAuthPath('/admin/op/orders')).toBe(false)
    expect(isPublicAuthPath('/admin/')).toBe(false)
    expect(isPublicAuthPath('/')).toBe(false)
  })
})
