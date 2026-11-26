import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'

const { signOut } = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve({ data: null, error: null })),
}))

vi.mock('../../lib/better-auth-client', () => ({
  authClient: { signOut },
}))

import api from '../../api/client'
import { useSessionStore } from '../../stores/session-store'

/**
 * POS api-client tests (Phase 3 central Better Auth cutover).
 *
 * The BA session cookie is the credential now: no Bearer token is ever
 * attached, there is no `/auth/refresh` replay, and a 401/403 signs out
 * and returns to the login screen. The `x-pos-session-id` BUSINESS
 * session header is untouched — it must ride on every request exactly
 * as before.
 *
 * The axios instance is driven through a stub adapter so no HTTP is made:
 * the adapter captures the outgoing config and either resolves or rejects
 * with a shaped error.
 */

let captured: InternalAxiosRequestConfig | null = null
let next: 'ok' | 401 | 403 | 500 = 'ok'
let calls = 0

function installAdapter() {
  calls = 0
  captured = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(api.defaults as any).adapter = async (config: InternalAxiosRequestConfig) => {
    calls += 1
    captured = config
    if (next === 'ok') {
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const error = new Error(`Request failed with status code ${next}`) as Error & {
      response: { status: number; data: unknown }
      config: InternalAxiosRequestConfig
    }
    error.response = { status: next, data: { message: 'boom' } }
    error.config = config
    throw error
  }
}

describe('POS api client (Phase 3)', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    installAdapter()
    // jsdom does not implement navigation — stub location so the
    // interceptor's redirect can be asserted instead of throwing.
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/pos/' },
      writable: true,
      configurable: true,
    })
    useSessionStore.getState().clearSession()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    useSessionStore.getState().clearSession()
  })

  it('attaches no Authorization header (no Bearer token anymore)', async () => {
    localStorage.setItem('pos_access_token', 'stale-token')
    try {
      await api.get('/pos/products')
    } finally {
      localStorage.removeItem('pos_access_token')
    }
    expect(captured).not.toBeNull()
    expect(captured!.headers['Authorization']).toBeUndefined()
  })

  it('attaches x-pos-session-id when a business session is open', async () => {
    useSessionStore.getState().setSession({
      id: 'sess-123',
      showroomId: 'show-1',
      showroomName: 'Main',
      cashierName: 'Aya',
    })
    await api.get('/pos/products')
    expect(captured!.headers['x-pos-session-id']).toBe('sess-123')
  })

  it('omits x-pos-session-id when no business session is open', async () => {
    await api.get('/pos/products')
    expect(captured!.headers['x-pos-session-id']).toBeUndefined()
  })

  it('on 401: signs out via the BA client and redirects to /pos/ without replaying', async () => {
    next = 401
    await expect(api.get('/pos/products')).rejects.toThrow()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/pos/')
    expect(calls).toBe(1)
  })

  it('on 403: signs out and redirects the same way', async () => {
    next = 403
    await expect(api.get('/pos/products')).rejects.toThrow()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/pos/')
    expect(calls).toBe(1)
  })

  it('on 500: propagates without signing out or redirecting', async () => {
    next = 500
    await expect(api.get('/pos/products')).rejects.toThrow()
    expect(signOut).not.toHaveBeenCalled()
    expect(window.location.href).toBe('http://localhost/pos/')
    expect(calls).toBe(1)
  })

  it('never calls /auth/refresh', async () => {
    next = 401
    await expect(api.get('/pos/products')).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
