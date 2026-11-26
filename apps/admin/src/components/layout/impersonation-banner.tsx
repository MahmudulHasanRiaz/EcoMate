import { useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import { sessionRedirect } from '@/lib/session-redirect'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'

/**
 * Impersonation banner (D8, Phase 1 §6/§8).
 *
 * Visible only while the BA session carries `impersonatedBy` — the central
 * user id of the platform operator who opened this store via the console
 * Impersonate button. "Stop" ends the impersonated session and returns
 * the operator to the SaaS console.
 *
 * The console URL comes from `VITE_CONSOLE_URL` (set per environment);
 * the fallback is the production console host.
 */
function consoleUrl(): string {
  return import.meta.env.VITE_CONSOLE_URL || 'https://saas.ecomate.bd'
}

export function ImpersonationBanner() {
  const impersonatedBy = useAuthStore((s) => s.auth.impersonatedBy)
  const [stopping, setStopping] = useState(false)

  if (!impersonatedBy) return null

  async function handleStop() {
    setStopping(true)
    try {
      // Restores the operator's own session from the `admin_session`
      // cookie (Phase 1: raw /admin/* endpoints are edge-blocked except
      // POST /admin/stop-impersonating).
      await authClient.admin.stopImpersonating()
    } catch {
      // Fall back to ending the impersonated session outright — either
      // way the operator must not stay signed in as the tenant owner.
      await authClient.signOut().catch(() => {})
      toast.error('Could not restore your console session — signed out instead.')
    } finally {
      useAuthStore.getState().auth.reset()
      sessionRedirect.assign(consoleUrl())
    }
  }

  return (
    <div
      role='status'
      className='flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
    >
      <span className='min-w-0 flex-1'>
        You are viewing this store as a platform operator (impersonated
        session). Password changes and data exports are blocked while
        impersonating.
      </span>
      <Button size='sm' disabled={stopping} onClick={handleStop}>
        {stopping ? 'Stopping…' : 'Stop impersonating'}
      </Button>
    </div>
  )
}
