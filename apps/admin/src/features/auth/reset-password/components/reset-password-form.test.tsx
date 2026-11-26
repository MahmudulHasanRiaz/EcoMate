import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent, type Locator } from 'vitest/browser'
import { ResetPasswordForm } from './reset-password-form'

/**
 * Phase 3 (D7=B): BA native reset — `authClient.resetPassword({
 * newPassword, token })` with the token from the emailed link's `?token=`.
 * Resetting revokes every other session (service-side).
 */

const navigateMock = vi.fn()
const resetPassword = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({
      children,
      to,
      className,
    }: {
      children?: React.ReactNode
      to: string
      className?: string
    }) => (
      <a href={to} className={className}>
        {children}
      </a>
    ),
  }
})

vi.mock('@/lib/better-auth-client', () => ({
  authClient: { resetPassword },
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

describe('ResetPasswordForm (Phase 3)', () => {
  let screen: RenderResult
  let passwordInput: Locator
  let confirmInput: Locator
  let resetButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    resetPassword.mockResolvedValue({ error: null })

    screen = await render(<ResetPasswordForm token='reset-token-123' />)
    passwordInput = screen.getByLabelText(/^New Password$/i)
    confirmInput = screen.getByLabelText(/^Confirm New Password$/i)
    resetButton = screen.getByRole('button', { name: /^Reset Password$/i })
  })

  it('rejects a password shorter than 8 characters', async () => {
    await userEvent.fill(passwordInput, 'Ab1!')
    await userEvent.fill(confirmInput, 'Ab1!')
    await userEvent.click(resetButton)

    await expect
      .element(
        screen.getByText(/^Password must be at least 8 characters long\.$/i),
      )
      .toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('rejects a password without an uppercase letter', async () => {
    await userEvent.fill(passwordInput, 'abcdef1!')
    await userEvent.fill(confirmInput, 'abcdef1!')
    await userEvent.click(resetButton)

    await expect
      .element(
        screen.getByText(/^Password must include an uppercase letter\.$/i),
      )
      .toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('rejects a password without a special character', async () => {
    await userEvent.fill(passwordInput, 'Abcdef12')
    await userEvent.fill(confirmInput, 'Abcdef12')
    await userEvent.click(resetButton)

    await expect
      .element(
        screen.getByText(/^Password must include a special character\.$/i),
      )
      .toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    await userEvent.fill(passwordInput, 'Abcdef1!')
    await userEvent.fill(confirmInput, 'Abcdef2!')
    await userEvent.click(resetButton)

    await expect
      .element(screen.getByText(/^Passwords don't match\.$/i))
      .toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('resets the password and navigates to /sign-in on success', async () => {
    await userEvent.fill(passwordInput, 'Abcdef1!')
    await userEvent.fill(confirmInput, 'Abcdef1!')
    await userEvent.click(resetButton)

    await vi.waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        newPassword: 'Abcdef1!',
        token: 'reset-token-123',
      }),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Password has been reset successfully')
    await vi.waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: '/sign-in' }),
    )
  })

  it('shows an expired-token error with a link back to forgot-password', async () => {
    resetPassword.mockResolvedValue({
      error: { message: 'Invalid or expired reset token', status: 400 },
    })

    await userEvent.fill(passwordInput, 'Abcdef1!')
    await userEvent.fill(confirmInput, 'Abcdef1!')
    await userEvent.click(resetButton)

    await expect
      .element(screen.getByText(/^Invalid or expired reset token$/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: /^Request a new link\.$/i }))
      .toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
