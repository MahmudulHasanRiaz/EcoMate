import { beforeEach, describe, expect, it, vi } from 'vitest'

async function importAuthStore() {
  const { useAuthStore } = await import('./auth-store')
  return useAuthStore
}

const sampleUser = {
  id: '1',
  email: 'user@example.com',
  role: 'admin',
}

/**
 * Phase 3: the BA session cookie is the ONLY credential — the store holds
 * no access token, no localStorage user cache, and no cookie persistence.
 * `isSignedIn` / `impersonatedBy` are synced from `useSession()` by the
 * authenticated layout's session bridge; `user` is the tenant profile
 * from `GET /auth/me`.
 */

/** The BA session user carries no `permissions` key; the store fills in []. */
const normalisedUser = { ...sampleUser, permissions: [] as string[] }

describe('useAuthStore (Phase 3)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('starts signed out, with no user and no impersonation', async () => {
    const useAuthStore = await importAuthStore()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
    expect(useAuthStore.getState().auth.impersonatedBy).toBeNull()
  })

  it('persists nothing to localStorage when the user is set', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setUser({ ...sampleUser })

    expect(localStorage.getItem('eco_mate_user')).toBeNull()
    expect(document.cookie).not.toContain('eco_mate_access_token')
  })

  it('updates the signed-in user via setUser', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setUser({ ...sampleUser })

    // The BA session user carries no permissions; the store fills in an
    // array so consumers never read `undefined`.
    expect(useAuthStore.getState().auth.user).toEqual(normalisedUser)
  })

  it('preserves permissions when they are present', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setUser({
      ...sampleUser,
      permissions: ['manage_hr_settings'],
    })

    expect(useAuthStore.getState().auth.user?.permissions).toEqual([
      'manage_hr_settings',
    ])
  })

  it('tracks the session flag via setSignedIn', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setSignedIn(true)
    expect(useAuthStore.getState().auth.isSignedIn).toBe(true)

    useAuthStore.getState().auth.setSignedIn(false)
    expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
  })

  it('tracks the impersonation actor via setImpersonatedBy', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setImpersonatedBy('operator-123')
    expect(useAuthStore.getState().auth.impersonatedBy).toBe('operator-123')

    useAuthStore.getState().auth.setImpersonatedBy(null)
    expect(useAuthStore.getState().auth.impersonatedBy).toBeNull()
  })

  it('reset clears user, session flag, and impersonation', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setSignedIn(true)
    useAuthStore.getState().auth.setImpersonatedBy('operator-123')
    useAuthStore.getState().auth.setUser({ ...sampleUser })

    useAuthStore.getState().auth.reset()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
    expect(useAuthStore.getState().auth.impersonatedBy).toBeNull()
  })
})
