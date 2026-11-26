import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { signInEmail, signInSocial, verifyTotp, verifyBackupCode, signOut, apiGet } =
  vi.hoisted(() => ({
    signInEmail: vi.fn(),
    signInSocial: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    signOut: vi.fn(() => Promise.resolve({ data: null, error: null })),
    apiGet: vi.fn(),
  }))

vi.mock('../../lib/better-auth-client', () => ({
  authClient: {
    signIn: { email: signInEmail, social: signInSocial },
    twoFactor: { verifyTotp, verifyBackupCode },
    signOut,
  },
}))

vi.mock('../../api/client', () => ({
  default: { get: apiGet },
}))

import { LoginPage } from '../../pages/login'

/**
 * POS login tests (Phase 3 central Better Auth cutover).
 *
 * Email sign-in goes through `authClient.signIn.email()`; the role gate
 * (cashier/admin/superadmin) is enforced after `GET /auth/me`; a
 * TOTP-enabled user is challenged instead of erroring; social buttons
 * call `signIn.social` with the fixed-host callback URLs.
 */

function fillLoginForm(email = 'cashier@shop.test', password = 'Secret123!') {
  fireEvent.change(screen.getByPlaceholderText('Enter email address'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByPlaceholderText('Enter password'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Launch POS Terminal' }))
}

describe('POS LoginPage (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    signInSocial.mockResolvedValue({ data: null, error: null })
    verifyTotp.mockResolvedValue({ data: { token: 't' }, error: null })
    verifyBackupCode.mockResolvedValue({ data: { token: 't' }, error: null })
    apiGet.mockResolvedValue({ data: { id: 'p1', role: 'cashier' } })
  })

  it('renders email/password fields and the three social buttons', () => {
    render(<LoginPage onSuccess={() => {}} />)
    expect(screen.getByPlaceholderText('Enter email address')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Facebook' })).toBeInTheDocument()
  })

  it('signs in via the BA client and enters the terminal for a cashier', async () => {
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)
    fillLoginForm()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(signInEmail).toHaveBeenCalledWith({
      email: 'cashier@shop.test',
      password: 'Secret123!',
    })
    expect(apiGet).toHaveBeenCalledWith('/auth/me')
  })

  it('shows a sign-in error inline and never enters the terminal', async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, message: 'Invalid email or password' },
    })
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)
    fillLoginForm()
    await waitFor(() =>
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument(),
    )
    expect(onSuccess).not.toHaveBeenCalled()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('refuses employee/packing_assistant/customer roles and signs back out', async () => {
    apiGet.mockResolvedValue({ data: { id: 'p1', role: 'employee' } })
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)
    fillLoginForm()
    await waitFor(() =>
      expect(
        screen.getByText('Access denied. Cashier or admin role required.'),
      ).toBeInTheDocument(),
    )
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('switches to the TOTP challenge on TWO_FACTOR_REQUIRED and verifies the code', async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 403, code: 'TWO_FACTOR_REQUIRED' },
    })
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)
    fillLoginForm()
    await waitFor(() =>
      expect(
        screen.getByText(/Two-factor authentication is on for this account/),
      ).toBeInTheDocument(),
    )
    expect(onSuccess).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(verifyTotp).toHaveBeenCalledWith({
      code: '123456',
      trustDevice: true,
    })
  })

  it('accepts a recovery code on the challenge screen', async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 403, body: { code: 'TWO_FACTOR_REQUIRED' } },
    })
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)
    fillLoginForm()
    await waitFor(() =>
      expect(
        screen.getByText(/Two-factor authentication is on for this account/),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Use a recovery code instead'))
    fireEvent.change(screen.getByPlaceholderText('XXXXX-XXXXX'), {
      target: { value: 'ABCDE-FGHIJ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'ABCDE-FGHIJ' })
  })

  it('wires the Google button to signIn.social with the POS callback URLs', async () => {
    render(<LoginPage onSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1))
    const args = signInSocial.mock.calls[0][0]
    expect(args.provider).toBe('google')
    expect(args.callbackURL).toBe('http://localhost:3000/pos/')
    expect(args.errorCallbackURL).toBe('http://localhost:3000/pos/')
  })

  it('shows the social error banner when returning with ?error=', () => {
    window.history.pushState({}, '', '/pos/?error=access_denied')
    render(<LoginPage onSuccess={() => {}} />)
    expect(
      screen.getByText('Social sign-in was cancelled. Please try again or sign in with email.'),
    ).toBeInTheDocument()
    window.history.pushState({}, '', '/pos/')
  })
})
