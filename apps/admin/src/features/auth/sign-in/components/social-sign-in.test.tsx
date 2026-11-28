import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SocialSignIn } from './social-sign-in'

/**
 * Phase 3 (D9=B): Google / GitHub / Facebook sign-in buttons, wired to
 * the central service's BA built-in OAuth config. Social works only on
 * the fixed host set (providers forbid wildcard redirect URIs).
 */

const signInSocial = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/better-auth-client', () => ({
  authClient: { signIn: { social: signInSocial } },
}))

vi.mock('sonner', () => ({
  toast: { error: toastError },
}))

describe('SocialSignIn (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInSocial.mockResolvedValue({ error: null })
  })

  it('renders all three provider buttons and NO custom-domain hint by default', async () => {
    const screen = await render(<SocialSignIn />)

    // Icon-only buttons: the provider name lives in the accessible name.
    await expect.element(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeInTheDocument()
    // Login polish: the default view stays Clerk-clean — the hint
    // shows only after a social failure (see next test).
    const hints = await screen.getByText(/Social sign-in works on your store's main address/).all()
    expect(hints.length).toBe(0)
    await expect.element(screen.getByText('or')).toBeInTheDocument()
  })

  it('shows the custom-domain hint only when a social button failed', async () => {
    const screen = await render(<SocialSignIn showCustomDomainHint />)

    await expect
      .element(screen.getByText(/Social sign-in works on your store's main address/))
      .toBeInTheDocument()
  })

  it('starts Google sign-in with the sign-in callback URLs', async () => {
    const screen = await render(<SocialSignIn redirectTo='/op/orders' />)

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(signInSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: `${window.location.origin}/admin/op/orders`,
      errorCallbackURL: `${window.location.origin}/admin/sign-in`,
    })
  })

  it('wires GitHub to its provider', async () => {
    const screen = await render(<SocialSignIn />)

    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }),
    )
  })

  it('wires Facebook to its provider', async () => {
    // A successful social start disables the other buttons (pending
    // provider), so each provider gets its own render.
    const screen = await render(<SocialSignIn />)

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Facebook' }))
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'facebook' }),
    )
  })

  it('shows an inline error when the provider redirect cannot start', async () => {
    signInSocial.mockResolvedValue({ error: { message: 'provider down' } })
    const screen = await render(<SocialSignIn />)

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(toastError).toHaveBeenCalledWith(
      'Could not start google sign-in. Please try email sign-in instead.',
    )
  })
})
