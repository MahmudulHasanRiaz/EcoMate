import { useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { authClient } from '@/lib/better-auth-client'
import { apiClient } from '@/lib/api-client'
import { useEntitlementsStore } from '@/stores/entitlements-store'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { PanelProvider } from '@/context/panel-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ImpersonationBanner } from '@/components/layout/impersonation-banner'
import { AttendanceClock } from '@/features/hr-attendance/components/attendance-clock'
import { PurgeAllCacheButton } from '@/features/cache-purge/components/purge-all-cache-button'
import { SkipToMain } from '@/components/skip-to-main'
import { toast } from 'sonner'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

/**
 * Authenticated layout — Phase 3 central Better Auth cutover.
 *
 * The BA session (`authClient.useSession()`) is the source of truth for
 * "signed in". The tenant profile (role, permissions, names) is enriched
 * once per session from the backend `GET /auth/me` — the central session
 * user carries no tenant role/permissions (the service has no
 * `customSession` enrichment), so that one call stays. What is gone:
 * the access-token cookie, the localStorage user cache, the `/auth/me`
 * prefetch entry, and the 5-minute keepalive poll (the BA session
 * refreshes server-side via `updateAge`).
 *
 * KEPT VERBATIM (survey §9): the customer bounce out of admin and the
 * packing_assistant force-route.
 */
export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.auth.user)
  const isSignedIn = useAuthStore((s) => s.auth.isSignedIn)
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: organizations } = authClient.useListOrganizations()
  const { data: activeOrganization } = authClient.useActiveOrganization()
  const defaultOrgAppliedRef = useRef(false)

  // Session bridge: a live BA session signs the store in; no session signs
  // it out and bounces to sign-in. The bounce marker preserves the
  // customer explanation across the redirect.
  useEffect(() => {
    if (sessionPending) return
    if (!session) {
      const { reset } = useAuthStore.getState().auth
      reset()
      const bounce = sessionStorage.getItem('admin_customer_bounce')
      sessionStorage.removeItem('admin_customer_bounce')
      navigate({
        to: '/sign-in',
        ...(bounce ? { search: { customer: '1' } as const } : {}),
        replace: true,
      })
      return
    }
    const { setSignedIn, setImpersonatedBy } = useAuthStore.getState().auth
    setSignedIn(true)
    setImpersonatedBy(session.session.impersonatedBy ?? null)
  }, [session, sessionPending, navigate])

  // Default active org = the org matching the current host on sign-in.
  // BA leaves `activeOrganizationId` null after sign-in; a user with one
  // org gets that org. Runs once per mount — `setActive` refetches the
  // session, which flips `activeOrganization` and stops the effect.
  useEffect(() => {
    if (!session || defaultOrgAppliedRef.current) return
    if (!organizations || organizations.length === 0) return
    if (activeOrganization) return
    const hostSlug = window.location.hostname.split('.')[0]
    const match =
      organizations.find((o) => o.slug === hostSlug) ??
      (organizations.length === 1 ? organizations[0] : undefined)
    if (!match) return
    defaultOrgAppliedRef.current = true
    authClient.organization
      .setActive({ organizationId: match.id })
      .catch(() => {
        // Non-fatal: the user can still pick a store from the switcher.
        defaultOrgAppliedRef.current = false
      })
  }, [session, organizations, activeOrganization])

  // A customer account must never use the admin app. Any customer session —
  // however it got here — is cleared and bounced to sign-in with an
  // explanation.
  useEffect(() => {
    if (user?.role !== 'customer') return
    const { reset } = useAuthStore.getState().auth
    sessionStorage.setItem('admin_customer_bounce', '1')
    reset()
    navigate({ to: '/sign-in', search: { customer: '1' }, replace: true })
  }, [user?.role, navigate])

  // Enrich the tenant profile once per session: role + permissions + names
  // come from the backend, which reads them off the central session.
  useEffect(() => {
    if (!session) return
    const { user: cachedUser, setUser, reset } = useAuthStore.getState().auth
    if (cachedUser?.permissions?.length) return

    let cancelled = false
    apiClient.get('/auth/me').then(r => {
      if (cancelled) return
      const u = r.data?.user || r.data
      if (!u) return
      setUser({
        id: u.id,
        email: u.email,
        role: u.role,
        permissions: u.permissions || [],
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
      })
      if (u.role === 'packing_assistant') {
        const isOnPacking = window.location.pathname.startsWith('/op/packing')
        if (!isOnPacking) navigate({ to: '/op/packing', replace: true })
      }
    }).catch(() => {
      if (cancelled) return
      // A session whose profile cannot be read must not sit in the shell.
      // The 401 interceptor already reset auth on a dead session; this
      // covers the remaining failure modes.
      const stillSignedIn = !!useAuthStore.getState().auth.isSignedIn
      if (!stillSignedIn) {
        reset()
        navigate({ to: '/sign-in', replace: true })
      }
    })
    return () => { cancelled = true }
  }, [session, navigate])

  // Enforce redirection for packing_assistant role on path changes
  useEffect(() => {
    if (user?.role === 'packing_assistant') {
      const isOnPacking = location.pathname.startsWith('/op/packing')
      if (!isOnPacking) {
        navigate({ to: '/op/packing', replace: true })
      }
    }
  }, [user, location.pathname, navigate])

  useEffect(() => {
    if (!isSignedIn) return

    const applyEntitlements = (data: { features?: string[] }) => {
      // /entitlements/me returns the effective feature list (`*` opens all).
      const newFeatures: string[] = data?.features || []
      const { added, removed } = useEntitlementsStore.getState().setFeatures(newFeatures)

      if (added.length > 0 && removed.length > 0) {
        toast.info(
          `Your plan has been updated. New: ${added.join(', ')}. Removed: ${removed.join(', ')}.`,
          { duration: 6000 }
        )
      } else if (added.length > 0) {
        toast.success(
          `New features unlocked: ${added.join(', ')}.`,
          { duration: 6000 }
        )
      } else if (removed.length > 0) {
        const hasInventory = removed.includes('admin_inventory')
        const inventoryNote = hasInventory
          ? ' Inventory is now read-only — existing products reverted to basic stock.'
          : ''
        toast.warning(
          `Features removed from your plan: ${removed.join(', ')}. Some sections may be hidden.${inventoryNote}`,
          { duration: 6000 }
        )
      }
    }

    // Prefetched by the inline script during bundle download — apply instantly.
    try {
      const raw = sessionStorage.getItem('admin_prefetch')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.entitlements) {
          applyEntitlements(parsed.entitlements)
          return
        }
      }
    } catch { /* fall through to API call */ }

    apiClient.get('/entitlements/me').then(r => applyEntitlements(r.data)).catch(() => {
      // A transient network failure must NOT look like "no plan": clearing
      // features here used to collapse the whole sidebar on a momentary blip.
    })
  }, [isSignedIn])

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'eco_mate_features' && e.newValue) {
        try {
          const features = JSON.parse(e.newValue)
          useEntitlementsStore.getState().setFeatures(features)
        } catch { /* ignore malformed feature payload */ }
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  if (sessionPending || !session) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid #e2e8f0',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            animation: 'auth-spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes auth-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const isPackingWorkspace = location.pathname.startsWith('/op/packing')

  // Panel identity for the 2px accent line under the top bar (presentational only).
  const panel = location.pathname.startsWith('/mon')
    ? 'monitoring'
    : location.pathname.startsWith('/hr')
      ? 'hr'
      : location.pathname.startsWith('/op/packing')
        ? 'packing'
        : 'operational'

  if (isPackingWorkspace) {
    return (
      <SearchProvider>
        <PanelProvider>
          <LayoutProvider>
            <div className="no-print"><SkipToMain /></div>
            <main
              data-panel="packing"
              className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950"
            >
              <div className="panel-accent-line" aria-hidden />
              <div className="px-3 pt-2 empty:hidden">
                <ImpersonationBanner />
              </div>
              {children ?? <Outlet />}
            </main>
          </LayoutProvider>
        </PanelProvider>
      </SearchProvider>
    )
  }

  return (
    <SearchProvider>
      <PanelProvider>
      <LayoutProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <div className="no-print"><SkipToMain /></div>
          <AppSidebar />
          {/* Portals the attendance clock into whatever <Header> the current
              page renders. Keeping it mounted here (not per-page) is what makes
              the clock available across the whole app. */}
          <AttendanceClock />
          {/* "Purge all cache" escape hatch (P0 stale-bundle round): small
              sticky desktop-corner button, superadmin-only (the component
              itself returns null for every other role). */}
          <PurgeAllCacheButton />
          <SidebarInset
            data-panel={panel}
            className={cn(
              '@container/content',
              'has-data-[layout=fixed]:h-svh',
              'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
            )}
          >
            <div className="px-3 pt-2 empty:hidden">
              <ImpersonationBanner />
            </div>
            {children ?? <Outlet />}
          </SidebarInset>
        </SidebarProvider>
      </LayoutProvider>
      </PanelProvider>
    </SearchProvider>
  )
}
