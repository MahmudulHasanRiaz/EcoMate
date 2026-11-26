import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const authState = vi.hoisted(() => ({
  isSignedIn: true as boolean,
  impersonatedBy: null as string | null,
  user: null as null | { id: string; email: string; role: string; permissions?: string[] },
}))

const setUser = vi.hoisted(() => vi.fn())
const setSignedIn = vi.hoisted(() => vi.fn())
const setImpersonatedBy = vi.hoisted(() => vi.fn())
const reset = vi.hoisted(() => vi.fn())
const getMe = vi.hoisted(() => vi.fn())
const getEntitlements = vi.hoisted(() => vi.fn())
const setActive = vi.hoisted(() => vi.fn())

/** Phase 3: the BA session is the source of truth — mock it, not tokens. */
const sessionState = vi.hoisted(() => ({
  session: {
    user: { id: 'u1', email: 'a@b.c', name: 'Admin' },
    session: { id: 's1', impersonatedBy: undefined as string | undefined, activeOrganizationId: null },
  } as any,
  pending: false,
  organizations: [] as any[],
  activeOrganization: null as any,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: any) => unknown) =>
      selector({
        auth: {
          isSignedIn: authState.isSignedIn,
          impersonatedBy: authState.impersonatedBy,
          user: authState.user,
          setUser,
          setSignedIn,
          setImpersonatedBy,
          reset,
        },
      }),
    {
      getState: () => ({
        auth: {
          isSignedIn: authState.isSignedIn,
          impersonatedBy: authState.impersonatedBy,
          user: authState.user,
          setUser,
          setSignedIn,
          setImpersonatedBy,
          reset,
        },
      }),
    }
  ),
}))

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    useSession: () => ({ data: sessionState.session, isPending: sessionState.pending }),
    useListOrganizations: () => ({ data: sessionState.organizations }),
    useActiveOrganization: () => ({ data: sessionState.activeOrganization }),
    organization: { setActive },
    admin: { stopImpersonating: vi.fn() },
  },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (url: string) => (url === '/auth/me' ? getMe() : getEntitlements()) },
  sessionRedirect: { assign: vi.fn(), reload: vi.fn() },
}))

vi.mock('@/stores/entitlements-store', () => ({
  useEntitlementsStore: Object.assign(
    (selector: (s: any) => unknown) => selector({ features: ['*'], setFeatures: vi.fn(), getState: () => ({ setFeatures: vi.fn() }) }),
    { getState: () => ({ setFeatures: vi.fn() }) }
  ),
}))

// Layout chrome is irrelevant to these assertions and pulls in the whole shell.
vi.mock('@/components/layout/app-sidebar', () => ({ AppSidebar: () => null }))
// The real widget portals into the <Header>; stub it so the layout test stays
// focused on permission + entitlement bootstrapping.
vi.mock('@/features/hr-attendance/components/attendance-clock', () => ({ AttendanceClock: () => null }))
// Same for the purge button: its mutation needs a QueryClient the layout
// test does not provide; the button itself is covered by its own tests.
vi.mock('@/features/cache-purge/components/purge-all-cache-button', () => ({ PurgeAllCacheButton: () => null }))
vi.mock('@/components/skip-to-main', () => ({ SkipToMain: () => null }))
vi.mock('@/components/layout/header', () => ({ Header: () => null }))
vi.mock('@/components/layout/main', () => ({ Main: ({ children }: any) => children }))
vi.mock('@/components/layout/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => children,
  SidebarInset: ({ children }: any) => children,
  SidebarTrigger: () => null,
}))
vi.mock('@/context/layout-provider', () => ({ LayoutProvider: ({ children }: any) => children }))
vi.mock('@/context/search-provider', () => ({ SearchProvider: ({ children }: any) => children }))
vi.mock('@/context/panel-provider', () => ({ PanelProvider: ({ children }: any) => children }))

const navigate = vi.hoisted(() => vi.fn())
const location = vi.hoisted(() => ({ pathname: '/op/overview' }))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useNavigate: () => navigate,
  useLocation: () => location,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/cookies', () => ({ getCookie: () => 'true', setCookie: vi.fn(), removeCookie: vi.fn() }))

import { AuthenticatedLayout } from './authenticated-layout'

describe('AuthenticatedLayout permission bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isSignedIn = true
    authState.impersonatedBy = null
    authState.user = null
    sessionState.session = {
      user: { id: 'u1', email: 'a@b.c', name: 'Admin' },
      session: { id: 's1', impersonatedBy: undefined, activeOrganizationId: null },
    }
    sessionState.pending = false
    sessionState.organizations = []
    sessionState.activeOrganization = null
    sessionStorage.clear()
    setActive.mockResolvedValue({})
    getEntitlements.mockResolvedValue({ data: { active: true, features: ['*'] } })
  })

  it('fetches /auth/me when no user is cached', async () => {
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['manage_hr_settings'] } })
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(getMe).toHaveBeenCalled())
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['manage_hr_settings'] })
    )
  })

  it('re-fetches when the cached user has NO permissions (the login-response shape)', async () => {
    // POST /auth/login returns { id, email, role } — no permissions key. That
    // object was cached verbatim, so every permission-gated surface read
    // `undefined` and the superadmin saw no HR Settings.
    authState.user = { id: 'u1', email: 'a@b.c', role: 'superadmin' }
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['manage_hr_settings'] } })

    render(<AuthenticatedLayout />)

    await waitFor(() => expect(getMe).toHaveBeenCalled())
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['manage_hr_settings'] })
    )
  })

  it('skips /auth/me once permissions are already present', async () => {
    authState.user = { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['view_hr'] }
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(getEntitlements).toHaveBeenCalled())
    expect(getMe).not.toHaveBeenCalled()
    expect(setUser).not.toHaveBeenCalled()
  })
})

describe("AuthenticatedLayout '*' wildcard handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isSignedIn = true
    authState.impersonatedBy = null
    authState.user = null
    sessionState.session = {
      user: { id: 'u1', email: 'a@b.c', name: 'Admin' },
      session: { id: 's1', impersonatedBy: undefined, activeOrganizationId: null },
    }
    sessionState.pending = false
    sessionState.organizations = []
    sessionState.activeOrganization = null
    sessionStorage.clear()
    setActive.mockResolvedValue({})
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'superadmin', permissions: ['*'] } })
  })

  it('reads the effective feature list from /entitlements/me', async () => {
    // The backend returns the effective list at the top level — that is where
    // the '*' wildcard lives. Reading a nested field alone yielded [] and hid
    // every sidebar section.
    getEntitlements.mockResolvedValue({ data: { features: ['*'], planName: 'All Access' } })
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(getEntitlements).toHaveBeenCalled())
    // No crash, and no redirect away from the requested page.
    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: '/mon/settings/plan' }),
      undefined
    )
  })
})

describe('AuthenticatedLayout session bridge (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isSignedIn = true
    authState.impersonatedBy = null
    authState.user = null
    sessionState.session = {
      user: { id: 'u1', email: 'a@b.c', name: 'Admin' },
      session: { id: 's1', impersonatedBy: undefined, activeOrganizationId: null },
    }
    sessionState.pending = false
    sessionState.organizations = []
    sessionState.activeOrganization = null
    sessionStorage.clear()
    setActive.mockResolvedValue({})
    getMe.mockResolvedValue({ data: { id: 'u1', email: 'a@b.c', role: 'admin', permissions: ['view_hr'] } })
    getEntitlements.mockResolvedValue({ data: { active: true, features: ['*'] } })
  })

  it('syncs the store to signed-in when a BA session exists', async () => {
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(true))
    expect(setImpersonatedBy).toHaveBeenCalledWith(null)
    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: '/sign-in' }),
    )
  })

  it('syncs impersonatedBy from the session', async () => {
    sessionState.session = {
      user: { id: 'u1', email: 'a@b.c', name: 'Admin' },
      session: { id: 's1', impersonatedBy: 'operator-9', activeOrganizationId: null },
    }
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(setImpersonatedBy).toHaveBeenCalledWith('operator-9'))
  })

  it('bounces to sign-in and resets when there is no session', async () => {
    sessionState.session = null
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(reset).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/sign-in', replace: true }),
    )
  })

  it('bounces a customer account to sign-in with ?customer=1', async () => {
    authState.user = { id: 'u9', email: 'shopper@example.com', role: 'customer', permissions: [] }
    render(<AuthenticatedLayout />)
    await waitFor(() => expect(reset).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/sign-in', search: { customer: '1' } }),
    )
  })

  it('force-routes a packing_assistant to /op/packing', async () => {
    getMe.mockResolvedValue({
      data: { id: 'u2', email: 'packer@example.com', role: 'packing_assistant', permissions: [] },
    })
    render(<AuthenticatedLayout />)
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/op/packing' }),
      ),
    )
  })

  it('sets the default active org matching the current host', async () => {
    // window.location.hostname is `localhost` in the test browser.
    sessionState.organizations = [
      { id: 'org-other', slug: 'other-store', name: 'Other' },
      { id: 'org-local', slug: 'localhost', name: 'Local' },
    ]
    render(<AuthenticatedLayout />)
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-local' }),
    )
  })

  it('does not set a default org when one is already active', async () => {
    sessionState.organizations = [{ id: 'org-local', slug: 'localhost', name: 'Local' }]
    sessionState.activeOrganization = { id: 'org-local', slug: 'localhost', name: 'Local' }
    render(<AuthenticatedLayout />)
    await new Promise((r) => setTimeout(r, 100))
    expect(setActive).not.toHaveBeenCalled()
  })
})
