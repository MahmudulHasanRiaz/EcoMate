import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent, type Locator } from 'vitest/browser'
import { Otp } from './index'

const search = vi.hoisted(() => ({ value: {} as { email?: string } }))
const navigateMock = vi.fn()
const postMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearch: () => search.value,
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

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: postMock },
}))

vi.mock('./components/otp-form', () => ({
  // NOTE: the stub must not render the email — getByText would otherwise
  // match both this stub and the card description (strict-mode violation).
  OtpForm: () => <div data-testid='otp-form'>otp form</div>,
}))

describe('Otp page', () => {
  let screen: RenderResult

  beforeEach(async () => {
    vi.clearAllMocks()
    postMock.mockResolvedValue({ data: {} })
    search.value = { email: 'a@b.com' }

    screen = await render(<Otp />)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the email the code was sent to', async () => {
    await expect
      .element(screen.getByText(/a@b\.com/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('otp-form'))
      .toBeInTheDocument()
  })

  it('redirects to /forgot-password when visited without an email', async () => {
    search.value = {}
    await render(<Otp />)

    await vi.waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/forgot-password',
        replace: true,
      }),
    )
  })

  it('resends the code to the same email and starts a cooldown', async () => {
    vi.useFakeTimers()
    const resendButton: Locator = screen.getByRole('button', {
      name: /^Resend a new code\.$/i,
    })

    await userEvent.click(resendButton)

    await vi.waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'a@b.com',
      }),
    )
    await expect
      .element(
        screen.getByRole('button', {
          name: /^Resend a new code in 30s\.$/i,
        }),
      )
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByRole('button', {
          name: /^Resend a new code in 30s\.$/i,
        }),
      )
      .toBeDisabled()
  })

  it('counts the cooldown down and re-enables resend', async () => {
    vi.useFakeTimers()
    const resendButton: Locator = screen.getByRole('button', {
      name: /^Resend a new code\.$/i,
    })

    await userEvent.click(resendButton)
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce())

    // Step the chained 1s timers one second at a time. Each step asserts
    // the displayed count, which polls in real time and gives React a
    // chance to flush the render and schedule the next timer — a single
    // runAllTimersAsync/advanceTimersByTimeAsync(30000) outruns the
    // re-render and stalls the chain.
    for (let remaining = 29; remaining > 0; remaining--) {
      await vi.advanceTimersByTimeAsync(1000)
      await expect
        .element(
          screen.getByRole('button', {
            name: new RegExp(`^Resend a new code in ${remaining}s\\.$`, 'i'),
          }),
        )
        .toBeInTheDocument()
    }
    await vi.advanceTimersByTimeAsync(1000)

    await expect
      .element(
        screen.getByRole('button', { name: /^Resend a new code\.$/i }),
      )
      .toBeEnabled()
  })

  it('still starts a cooldown when the resend request fails', async () => {
    postMock.mockRejectedValue({
      response: { data: { message: 'Too many requests' } },
    })
    const resendButton: Locator = screen.getByRole('button', {
      name: /^Resend a new code\.$/i,
    })

    await userEvent.click(resendButton)

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce())
    await expect
      .element(
        screen.getByRole('button', {
          name: /^Resend a new code in 30s\.$/i,
        }),
      )
      .toBeInTheDocument()
  })
})
