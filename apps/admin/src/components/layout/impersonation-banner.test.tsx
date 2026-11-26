import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ImpersonationBanner } from './impersonation-banner'
import { useAuthStore } from '@/stores/auth-store'
import { sessionRedirect } from '@/lib/api-client'

/**
 * Phase 3 (D8): visible only while the BA session carries
 * `impersonatedBy`. "Stop" ends the impersonation and returns the
 * operator to the SaaS console.
 *
 * The redirect goes through the `sessionRedirect` seam (same one the
 * api-client 401 handler uses): `window.location.assign` is
 * non-configurable on the Location object in Chromium, so it cannot be
 * spied on directly.
 */

const stopImpersonating = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    admin: { stopImpersonating },
    signOut,
  },
}))

vi.mock('sonner', () => ({
  toast: { error: toastError },
}))

describe('ImpersonationBanner (Phase 3)', () => {
  let assignSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().auth.reset()
    stopImpersonating.mockResolvedValue({})
    signOut.mockResolvedValue({})
    assignSpy = vi.spyOn(sessionRedirect, 'assign').mockImplementation(() => {})
  })

  it('renders nothing when not impersonating', async () => {
    const screen = await render(<ImpersonationBanner />)
    const matches = await screen.getByRole('button', { name: 'Stop impersonating' }).all()
    expect(matches.length).toBe(0)
  })

  it('shows the banner while impersonating', async () => {
    useAuthStore.getState().auth.setImpersonatedBy('operator-1')
    const { getByText, getByRole } = await render(<ImpersonationBanner />)

    await expect
      .element(getByText('You are viewing this store as a platform operator (impersonated session). Password changes and data exports are blocked while impersonating.'))
      .toBeInTheDocument()
    await expect.element(getByRole('button', { name: 'Stop impersonating' })).toBeInTheDocument()
  })

  it('stops impersonating, resets auth, and returns to the console', async () => {
    useAuthStore.getState().auth.setSignedIn(true)
    useAuthStore.getState().auth.setImpersonatedBy('operator-1')
    const { getByRole } = await render(<ImpersonationBanner />)

    await userEvent.click(getByRole('button', { name: 'Stop impersonating' }))

    expect(stopImpersonating).toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
    expect(useAuthStore.getState().auth.impersonatedBy).toBeNull()
    expect(assignSpy).toHaveBeenCalledWith('https://saas.ecomate.bd')
  })

  it('falls back to sign-out when restoring the operator session fails', async () => {
    stopImpersonating.mockRejectedValue(new Error('edge blocked'))
    useAuthStore.getState().auth.setImpersonatedBy('operator-1')
    const { getByRole } = await render(<ImpersonationBanner />)

    await userEvent.click(getByRole('button', { name: 'Stop impersonating' }))

    expect(signOut).toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      'Could not restore your console session — signed out instead.',
    )
    expect(assignSpy).toHaveBeenCalledWith('https://saas.ecomate.bd')
  })
})
