import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ResetPassword } from './index'

const locationState = vi.hoisted(() => ({
  value: undefined as { resetToken?: string } | undefined,
}))

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useLocation: () => ({ state: locationState.value }),
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

vi.mock('./components/reset-password-form', () => ({
  ResetPasswordForm: ({ token }: { token: string }) => (
    <div data-testid='reset-password-form'>reset form for {token}</div>
  ),
}))

describe('ResetPassword page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form when a reset token is in router state', async () => {
    locationState.value = { resetToken: 'reset-jwt' }
    const screen = await render(<ResetPassword />)

    await expect
      .element(screen.getByTestId('reset-password-form'))
      .toBeInTheDocument()
  })

  it('shows an expired message with a link back when there is no token', async () => {
    locationState.value = undefined
    const screen = await render(<ResetPassword />)

    await expect
      .element(screen.getByText(/^Reset link expired$/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: /^Request a new code$/i }))
      .toBeInTheDocument()
  })
})
