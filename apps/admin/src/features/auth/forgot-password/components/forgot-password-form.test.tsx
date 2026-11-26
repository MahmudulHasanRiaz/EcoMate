import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent, type Locator } from 'vitest/browser'
import { ForgotPasswordForm } from './forgot-password-form'

/**
 * D7 flip (2026-11-26): OTP flow replaces the Phase 3 BA native reset
 * LINKS. The form calls `authClient.emailOtp.requestPasswordReset()` to
 * send a 6-digit code, then `authClient.emailOtp.resetPassword()` with
 * the code + new password. The confirmation stays generic (anti-enumeration).
 */

const requestPasswordReset = vi.hoisted(() => vi.fn())
const resetPassword = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    emailOtp: { requestPasswordReset, resetPassword },
  },
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigate }
})

describe('ForgotPasswordForm (D7 flip — OTP)', () => {
  let screen: RenderResult
  let emailInput: Locator
  let sendButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    requestPasswordReset.mockResolvedValue({ error: null })
    resetPassword.mockResolvedValue({ error: null })

    screen = await render(<ForgotPasswordForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    sendButton = screen.getByRole('button', { name: /^Send reset code$/i })
  })

  it('renders email field and send-reset-code button', async () => {
    await expect.element(emailInput).toBeInTheDocument()
    await expect.element(sendButton).toBeInTheDocument()
  })

  it('shows validation when submitting empty form', async () => {
    await userEvent.click(sendButton)
    await expect
      .element(screen.getByText(/^Please enter your email\.$/i))
      .toBeInTheDocument()
    expect(requestPasswordReset).not.toHaveBeenCalled()
  })

  it('requests a reset code and shows the OTP + new-password step', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)

    await vi.waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith({
        email: 'a@b.com',
      }),
    )
    await expect
      .element(
        screen.getByText(/If an account exists for a@b\.com, a 6-digit reset code is on its way/i),
      )
      .toBeInTheDocument()
    await expect.element(screen.getByText(/^Reset code$/i)).toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /Resend code/i }))
      .toBeInTheDocument()
  })

  it('shows the same confirmation when the request fails (anti-enumeration)', async () => {
    requestPasswordReset.mockRejectedValue(new Error('network down'))

    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)

    await expect
      .element(
        screen.getByText(/If an account exists for a@b\.com, a 6-digit reset code is on its way/i),
      )
      .toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalledWith(
      'If the email exists, a reset code has been sent',
    )
  })

  it('resets the password with the code and navigates to sign-in', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)
    await vi.waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalled(),
    )

    const codeInput = screen.container.querySelector(
      'input[autocomplete="one-time-code"]',
    )
    expect(codeInput).not.toBeNull()
    await userEvent.fill(codeInput as HTMLInputElement, '123456')
    await userEvent.fill(
      screen.getByLabelText(/^New Password$/i),
      'NewPass1!',
    )
    await userEvent.fill(
      screen.getByLabelText(/^Confirm New Password$/i),
      'NewPass1!',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /^Reset Password$/i }),
    )

    await vi.waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        email: 'a@b.com',
        otp: '123456',
        password: 'NewPass1!',
      }),
    )
    expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' })
  })

  it('returns to the form when sending to a different email', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)
    await expect
      .element(screen.getByText(/If an account exists for a@b\.com/i))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Send to a different email/i }))
    await expect.element(screen.getByRole('button', { name: /^Send reset code$/i })).toBeInTheDocument()
  })
})
