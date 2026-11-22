import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { OtpForm } from './otp-form'

const navigate = vi.fn()
const postMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: postMock },
}))

describe('OtpForm', () => {
  let screen: RenderResult
  let otpInput: Locator
  let verifyButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    postMock.mockResolvedValue({ data: { resetToken: 'reset-jwt' } })

    screen = await render(<OtpForm email='a@b.com' />)
    otpInput = screen.getByLabelText(/^One-Time Password$/i)
    verifyButton = screen.getByRole('button', { name: /^Verify$/i })
  })

  it('disables Verify until 6 digits are entered', async () => {
    await expect.element(verifyButton).toBeDisabled()

    await userEvent.fill(otpInput, '12345')
    await expect.element(verifyButton).toBeDisabled()

    await userEvent.fill(otpInput, '123456')
    await expect.element(verifyButton).toBeEnabled()
  })

  it('verifies the code and navigates to /reset-password with the token', async () => {
    await userEvent.fill(otpInput, '123456')
    await userEvent.click(verifyButton)

    await vi.waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/auth/verify-otp', {
        email: 'a@b.com',
        otp: '123456',
      }),
    )
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/reset-password',
        state: { resetToken: 'reset-jwt' },
      }),
    )
  })

  it('shows the backend error inline and stays on the page on a wrong code', async () => {
    postMock.mockRejectedValue({
      response: { data: { message: 'Invalid or expired OTP' } },
    })

    await userEvent.fill(otpInput, '000000')
    await userEvent.click(verifyButton)

    await expect
      .element(screen.getByText(/^Invalid or expired OTP$/i))
      .toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('surfaces the too-many-attempts message instead of redirecting', async () => {
    postMock.mockRejectedValue({
      response: {
        data: { message: 'Too many failed attempts. Request a new code.' },
      },
    })

    await userEvent.fill(otpInput, '000000')
    await userEvent.click(verifyButton)

    await expect
      .element(
        screen.getByText(/^Too many failed attempts\. Request a new code\.$/i),
      )
      .toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })
})
