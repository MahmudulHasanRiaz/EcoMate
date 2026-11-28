import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_LOGIN_METHODS,
  type LoginMethods,
  type PublicBranding,
} from '../../branding'

/**
 * Login round 2: the sign-in methods shown (and the default that
 * opens) come from the tenant's `login_methods` setting via
 * usePublicBranding. The hook is mocked here with a mutable value
 * (null = branding not loaded yet → the form's defaults apply).
 */
const brandingMethods = vi.hoisted(() => ({
  value: null as LoginMethods | null,
}))

vi.mock('../../use-public-branding', () => ({
  usePublicBranding: () => ({
    branding: brandingMethods.value
      ? ({ loginMethods: brandingMethods.value } as unknown as PublicBranding)
      : null,
    isLoading: false,
    isError: false,
  }),
}))

/**
 * Phase 3: sign-in goes through `authClient.signIn.email()` (BA client),
 * the tenant profile comes from `GET /auth/me`, and there is no access
 * token to store. A TOTP-enabled user gets TWO_FACTOR_REQUIRED and sees
 * the challenge screen instead of an error.
 *
 * Login polish: email-first, one step at a time — step 1 is ONLY the
 * email field + Continue; step 2 is the password field (with the
 * Password / Email-code choice as a subtle switcher link, not tabs).
 */

const navigate = vi.hoisted(() => vi.fn())
const signInEmail = vi.hoisted(() => vi.fn())
const signInEmailOtp = vi.hoisted(() => vi.fn())
const sendVerificationOtp = vi.hoisted(() => vi.fn())
const signInSocial = vi.hoisted(() => vi.fn())
const verifyTotp = vi.hoisted(() => vi.fn())
const verifyBackupCode = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const refetchSession = vi.hoisted(() => vi.fn())
const getMe = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to, className }: { children?: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}))

vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}))

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    signIn: { email: signInEmail, social: signInSocial, emailOtp: signInEmailOtp },
    emailOtp: { sendVerificationOtp },
    twoFactor: { verifyTotp, verifyBackupCode },
    signOut,
    useSession: () => ({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: refetchSession,
    }),
  },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: getMe },
}))

const staffProfile = {
  id: 'u1',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['view_hr'],
}

/** Step 1 (email + Continue) then step 2 (password + Sign in). */
async function fillAndSubmit(email: string, password: string): Promise<RenderResult> {
  const screen = await render(<UserAuthForm />)
  await userEvent.fill(screen.getByLabelText('Email address'), email)
  await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
  await userEvent.fill(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }))
  return screen
}

/** Step 1 only, then the "Email me a sign-in code instead" switcher. */
async function goToOtpCodeStep(email: string): Promise<RenderResult> {
  const screen = await render(<UserAuthForm />)
  await userEvent.fill(screen.getByLabelText('Email address'), email)
  await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
  await userEvent.click(screen.getByText('Email me a sign-in code instead'))
  await vi.waitFor(() =>
    expect(sendVerificationOtp).toHaveBeenCalledWith({
      email,
      type: 'sign-in',
    }),
  )
  return screen
}

describe('UserAuthForm (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    brandingMethods.value = null
    useAuthStore.getState().auth.reset()
    signInEmail.mockResolvedValue({ error: null })
    signInEmailOtp.mockResolvedValue({ error: null })
    sendVerificationOtp.mockResolvedValue({ error: null })
    signInSocial.mockResolvedValue({ error: null })
    verifyTotp.mockResolvedValue({ error: null })
    verifyBackupCode.mockResolvedValue({ error: null })
    signOut.mockResolvedValue({})
    refetchSession.mockResolvedValue(undefined)
    getMe.mockResolvedValue({ data: staffProfile })
  })

  it('step 1 shows ONLY the email field + Continue (no password yet)', async () => {
    const screen = await render(<UserAuthForm />)

    await expect.element(screen.getByLabelText('Email address')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Continue', exact: true })).toBeInTheDocument()
    const passwords = await screen.getByLabelText('Password').all()
    expect(passwords.length).toBe(0)
    // No method tabs — the choice lives on step 2 as a switcher link.
    const tablists = await screen.getByRole('tablist').all()
    expect(tablists.length).toBe(0)
    const tabs = await screen.getByRole('tab').all()
    expect(tabs.length).toBe(0)
  })

  it('shows the email validation error when submitting an empty step 1', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))

    await expect.element(screen.getByText('Please enter your email.')).toBeInTheDocument()
    expect(signInEmail).not.toHaveBeenCalled()
  })

  it('shows the password validation error on an empty step 2', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }))

    await expect.element(screen.getByText('Please enter your password.')).toBeInTheDocument()
    expect(signInEmail).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 6 characters', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    await userEvent.fill(screen.getByLabelText('Password'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }))

    await expect
      .element(screen.getByText('Password must be at least 6 characters long.'))
      .toBeInTheDocument()
    expect(signInEmail).not.toHaveBeenCalled()
  })

  it('signs in, loads the tenant profile, and navigates into the app', async () => {
    await fillAndSubmit('admin@example.com', 'correct horse battery')

    expect(signInEmail).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'correct horse battery',
    })
    expect(getMe).toHaveBeenCalledWith('/auth/me')
    expect(useAuthStore.getState().auth.user).toEqual(
      expect.objectContaining({ id: 'u1', role: 'admin', permissions: ['view_hr'] }),
    )
    expect(useAuthStore.getState().auth.isSignedIn).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('refreshes the client session cache before navigating after sign-in', async () => {
    // Live 2026-11-27: after a successful login the app stayed on the
    // sign-in page because the authenticated layout saw a stale cached
    // null session. The form refreshes the BA client's session cache
    // (fresh server check, no cookie cache) as part of completing the
    // sign-in, so the layout lands on a live session.
    await fillAndSubmit('admin@example.com', 'correct horse battery')

    expect(refetchSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    )
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('navigates to redirectTo when provided', async () => {
    const screen = await render(<UserAuthForm redirectTo='/op/orders' />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    await userEvent.fill(screen.getByLabelText('Password'), 'correct horse battery')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }))

    expect(navigate).toHaveBeenCalledWith({ to: '/op/orders', replace: true })
  })

  it('shows the server error and stays signed out on invalid credentials', async () => {
    signInEmail.mockResolvedValue({
      error: { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 },
    })
    await fillAndSubmit('admin@example.com', 'wrong password')

    expect(toastError).toHaveBeenCalledWith('Invalid email or password')
    expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows the TOTP challenge screen on TWO_FACTOR_REQUIRED', async () => {
    signInEmail.mockResolvedValue({
      error: { message: 'Two-factor required', code: 'TWO_FACTOR_REQUIRED', status: 403 },
    })
    const screen = await fillAndSubmit('admin@example.com', 'correct horse battery')

    await expect
      .element(screen.getByText('Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app to continue.'))
      .toBeInTheDocument()
    expect(getMe).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('verifies the TOTP code and completes sign-in', async () => {
    signInEmail.mockResolvedValue({
      error: { message: 'Two-factor required', code: 'TWO_FACTOR_REQUIRED', status: 403 },
    })
    const screen = await fillAndSubmit('admin@example.com', 'correct horse battery')
    await expect
      .element(screen.getByText('Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app to continue.'))
      .toBeInTheDocument()

    const otpInput = screen.container.querySelector('input[autocomplete="one-time-code"]')
    expect(otpInput).not.toBeNull()
    await userEvent.fill(otpInput as HTMLInputElement, '123456')
    await userEvent.click(screen.getByText('Verify and sign in'))

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true })
    expect(useAuthStore.getState().auth.isSignedIn).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('verifies a recovery code from the challenge screen', async () => {
    signInEmail.mockResolvedValue({
      error: { message: 'Two-factor required', code: 'TWO_FACTOR_REQUIRED', status: 403 },
    })
    const screen = await fillAndSubmit('admin@example.com', 'correct horse battery')
    await userEvent.click(screen.getByText('Use a recovery code instead'))

    await userEvent.fill(screen.getByLabelText('Recovery code'), 'ABCDE-12345')
    await userEvent.click(screen.getByText('Verify and sign in'))

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'ABCDE-12345' })
    expect(useAuthStore.getState().auth.isSignedIn).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('bounces a customer account out: banner, sign-out, no navigation', async () => {
    getMe.mockResolvedValue({
      data: { id: 'u9', email: 'shopper@example.com', role: 'customer', permissions: [] },
    })
    const screen = await fillAndSubmit('shopper@example.com', 'correct horse battery')

    await expect
      .element(screen.getByText('You are signed in with a customer account. Customer accounts cannot access the admin application.'))
      .toBeInTheDocument()
    expect(signOut).toHaveBeenCalled()
    expect(useAuthStore.getState().auth.isSignedIn).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('renders the three social buttons and wires Google to signIn.social', async () => {
    const screen = await render(<UserAuthForm />)

    // Icon-only row: provider names live in the accessible names only.
    await expect.element(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeInTheDocument()
    // Login polish: no custom-domain hint on the default view.
    const hints = await screen.getByText(/Social sign-in works on your store's main address/).all()
    expect(hints.length).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
    )
    const call = signInSocial.mock.calls[0][0]
    expect(call.callbackURL).toContain(window.location.origin)
    expect(call.errorCallbackURL).toContain('/sign-in')
  })

  it('shows the custom-domain hint only after a social failure', async () => {
    const screen = await render(<UserAuthForm showCustomDomainHint />)

    await expect
      .element(screen.getByText(/Social sign-in works on your store's main address/))
      .toBeInTheDocument()
  })

  it('OTP login: sends a code, verifies it, and completes sign-in', async () => {
    const screen = await goToOtpCodeStep('admin@example.com')

    const otpInput = screen.container.querySelector('input[autocomplete="one-time-code"]')
    expect(otpInput).not.toBeNull()
    await userEvent.fill(otpInput as HTMLInputElement, '123456')
    await userEvent.click(screen.getByText('Verify and sign in'))

    expect(signInEmailOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      otp: '123456',
    })
    expect(useAuthStore.getState().auth.isSignedIn).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('OTP login: resend starts a 30-second cooldown, then requests a fresh code', async () => {
    const screen = await goToOtpCodeStep('admin@example.com')
    await vi.waitFor(() =>
      expect(sendVerificationOtp).toHaveBeenCalledTimes(1),
    )

    // Cooldown engages immediately: the button is disabled with a countdown.
    const resend = screen.getByRole('button', { name: /Resend code/ })
    await expect.element(resend).toBeDisabled()
    await expect.element(screen.getByText(/Resend code \(\d+s\)/)).toBeInTheDocument()

    // After the cooldown elapses the same button resends (rotates the code).
    await vi.waitFor(
      async () => {
        const btn = screen.getByRole('button', { name: /Resend code/ })
        await expect.element(btn).not.toBeDisabled()
      },
      { timeout: 34000 },
    )
    await userEvent.click(screen.getByRole('button', { name: 'Resend code' }))
    await vi.waitFor(() =>
      expect(sendVerificationOtp).toHaveBeenCalledTimes(2),
    )
    expect(sendVerificationOtp).toHaveBeenNthCalledWith(2, {
      email: 'admin@example.com',
      type: 'sign-in',
    })
  }, 45000)

  it('switches back from the code step to the password step', async () => {
    const screen = await goToOtpCodeStep('admin@example.com')

    await userEvent.click(screen.getByText('Use password instead'))
    await expect.element(screen.getByLabelText('Password')).toBeInTheDocument()
    await expect.element(screen.getByText('Email me a sign-in code instead')).toBeInTheDocument()
  })

  it('goes back to the email step from the password step', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    await expect.element(screen.getByText(/Signing in as/)).toBeInTheDocument()

    await userEvent.click(screen.getByText('Change'))
    await expect.element(screen.getByLabelText('Email address')).toBeInTheDocument()
    const passwords = await screen.getByLabelText('Password').all()
    expect(passwords.length).toBe(0)
  })

  it('opens the email-OTP code step by default when emailOtp is the default method', async () => {
    brandingMethods.value = {
      password: true,
      emailOtp: true,
      phoneOtp: false,
      default: 'emailOtp',
    }
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))

    // The code is sent straight from step 1 — no password step first.
    await vi.waitFor(() =>
      expect(sendVerificationOtp).toHaveBeenCalledWith({
        email: 'admin@example.com',
        type: 'sign-in',
      }),
    )
    const otpInput = screen.container.querySelector(
      'input[autocomplete="one-time-code"]',
    )
    expect(otpInput).not.toBeNull()
    const passwords = await screen.getByLabelText('Password').all()
    expect(passwords.length).toBe(0)
  })

  it('hides the email-code switcher when email OTP is disabled', async () => {
    brandingMethods.value = {
      password: true,
      emailOtp: false,
      phoneOtp: false,
      default: 'password',
    }
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))

    await expect.element(screen.getByLabelText('Password')).toBeInTheDocument()
    const switchers = await screen
      .getByText('Email me a sign-in code instead')
      .all()
    expect(switchers.length).toBe(0)
    expect(sendVerificationOtp).not.toHaveBeenCalled()
  })

  it('password disabled: the code step opens with no password switcher', async () => {
    brandingMethods.value = {
      password: false,
      emailOtp: true,
      phoneOtp: false,
      default: 'emailOtp',
    }
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))

    await vi.waitFor(() =>
      expect(sendVerificationOtp).toHaveBeenCalledWith({
        email: 'admin@example.com',
        type: 'sign-in',
      }),
    )
    const switchers = await screen.getByText('Use password instead').all()
    expect(switchers.length).toBe(0)
  })

  it('falls back to the password step when the default email-OTP code cannot be sent', async () => {
    brandingMethods.value = {
      password: true,
      emailOtp: true,
      phoneOtp: false,
      default: 'emailOtp',
    }
    sendVerificationOtp.mockResolvedValue({
      error: { message: 'Mail service down' },
    })
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))

    await expect.element(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(toastError).toHaveBeenCalledWith('Mail service down')
  })

  it('uses the password default while branding is still loading', async () => {
    // brandingMethods.value is null in beforeEach — the form's
    // DEFAULT_LOGIN_METHODS apply, so step 2 is the password step.
    expect(DEFAULT_LOGIN_METHODS.default).toBe('password')
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email address'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))

    await expect.element(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(sendVerificationOtp).not.toHaveBeenCalled()
  })
})
