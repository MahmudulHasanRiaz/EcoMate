import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Phase 3: sign-in goes through `authClient.signIn.email()` (BA client),
 * the tenant profile comes from `GET /auth/me`, and there is no access
 * token to store. A TOTP-enabled user gets TWO_FACTOR_REQUIRED and sees
 * the challenge screen instead of an error.
 */

const navigate = vi.hoisted(() => vi.fn())
const signInEmail = vi.hoisted(() => vi.fn())
const signInEmailOtp = vi.hoisted(() => vi.fn())
const sendVerificationOtp = vi.hoisted(() => vi.fn())
const signInSocial = vi.hoisted(() => vi.fn())
const verifyTotp = vi.hoisted(() => vi.fn())
const verifyBackupCode = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
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

async function fillAndSubmit(email: string, password: string): Promise<RenderResult> {
  const screen = await render(<UserAuthForm />)
  await userEvent.fill(screen.getByLabelText('Email'), email)
  await userEvent.fill(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  return screen
}

describe('UserAuthForm (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().auth.reset()
    signInEmail.mockResolvedValue({ error: null })
    signInEmailOtp.mockResolvedValue({ error: null })
    sendVerificationOtp.mockResolvedValue({ error: null })
    signInSocial.mockResolvedValue({ error: null })
    verifyTotp.mockResolvedValue({ error: null })
    verifyBackupCode.mockResolvedValue({ error: null })
    signOut.mockResolvedValue({})
    getMe.mockResolvedValue({ data: staffProfile })
  })

  it('shows validation errors when submitting an empty form', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await expect.element(screen.getByText('Please enter your email.')).toBeInTheDocument()
    await expect.element(screen.getByText('Please enter your password.')).toBeInTheDocument()
    expect(signInEmail).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 6 characters', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.fill(screen.getByLabelText('Email'), 'admin@example.com')
    await userEvent.fill(screen.getByLabelText('Password'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

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

  it('navigates to redirectTo when provided', async () => {
    const screen = await render(<UserAuthForm redirectTo='/op/orders' />)
    await userEvent.fill(screen.getByLabelText('Email'), 'admin@example.com')
    await userEvent.fill(screen.getByLabelText('Password'), 'correct horse battery')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

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

    await expect.element(screen.getByText('Google')).toBeInTheDocument()
    await expect.element(screen.getByText('GitHub')).toBeInTheDocument()
    await expect.element(screen.getByText('Facebook')).toBeInTheDocument()
    await expect
      .element(screen.getByText(/Social sign-in works on your store's main address/))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
    )
    const call = signInSocial.mock.calls[0][0]
    expect(call.callbackURL).toContain(window.location.origin)
    expect(call.errorCallbackURL).toContain('/sign-in')
  })

  it('OTP login: sends a code, verifies it, and completes sign-in', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.click(screen.getByRole('button', { name: 'OTP diye login' }))

    await userEvent.fill(screen.getByLabelText('Email'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
    expect(sendVerificationOtp).toHaveBeenCalledWith({
      email: 'admin@example.com',
      type: 'sign-in',
    })

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

  it('OTP login: resend requests a fresh code', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.click(screen.getByRole('button', { name: 'OTP diye login' }))
    await userEvent.fill(screen.getByLabelText('Email'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
    await vi.waitFor(() =>
      expect(sendVerificationOtp).toHaveBeenCalledTimes(1),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Resend code' }))
    await vi.waitFor(() =>
      expect(sendVerificationOtp).toHaveBeenCalledTimes(2),
    )
    expect(sendVerificationOtp).toHaveBeenNthCalledWith(2, {
      email: 'admin@example.com',
      type: 'sign-in',
    })
  })
})
