import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent, type Locator } from 'vitest/browser'
import { ForgotPasswordForm } from './forgot-password-form'

/**
 * Phase 3 (D7=B): BA native reset LINKS replace the OTP flow — the form
 * calls `authClient.requestPasswordReset()` and shows the same generic
 * confirmation whether or not the email exists (anti-enumeration).
 * There is no `/otp` navigation anymore.
 */

const requestPasswordReset = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/better-auth-client', () => ({
  authClient: { requestPasswordReset },
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess },
}))

describe('ForgotPasswordForm (Phase 3)', () => {
  let screen: RenderResult
  let emailInput: Locator
  let sendButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    requestPasswordReset.mockResolvedValue({ error: null })

    screen = await render(<ForgotPasswordForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    sendButton = screen.getByRole('button', { name: /^Send reset link$/i })
  })

  it('renders email field and send-reset-link button', async () => {
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

  it('requests a reset link and shows the generic confirmation on success', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)

    await vi.waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith({
        email: 'a@b.com',
        redirectTo: expect.stringContaining('/reset-password'),
      }),
    )
    await expect
      .element(screen.getByText(/If an account exists for a@b\.com, a password reset link is on its way/i))
      .toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: /Send to a different email/i })).toBeInTheDocument()
  })

  it('shows the same confirmation when the request fails (anti-enumeration)', async () => {
    requestPasswordReset.mockRejectedValue(new Error('network down'))

    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)

    await expect
      .element(screen.getByText(/If an account exists for a@b\.com, a password reset link is on its way/i))
      .toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalledWith('If the email exists, a reset link has been sent')
  })

  it('returns to the form when sending to a different email', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(sendButton)
    await expect
      .element(screen.getByText(/If an account exists for a@b\.com/i))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Send to a different email/i }))
    await expect.element(screen.getByRole('button', { name: /^Send reset link$/i })).toBeInTheDocument()
  })
})
