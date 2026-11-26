import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ResetPassword } from './index'

/**
 * Phase 3 (D7=B): the BA native reset link lands here as
 * `/reset-password?token=…` — the page reads the token from `useSearch`,
 * not from router location state. `?error=INVALID_TOKEN` (or no token)
 * shows the expired card with a link back to forgot-password.
 */

const search = vi.hoisted(() => ({
  value: {} as { token?: string; error?: string },
}))

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
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

vi.mock('./components/reset-password-form', () => ({
  ResetPasswordForm: ({ token }: { token: string }) => (
    <div data-testid='reset-password-form'>reset form for {token}</div>
  ),
}))

describe('ResetPassword page (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    search.value = {}
  })

  it('renders the form when a reset token is in the URL', async () => {
    search.value = { token: 'reset-token-123' }
    const screen = await render(<ResetPassword />)

    await expect
      .element(screen.getByTestId('reset-password-form'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('reset form for reset-token-123'))
      .toBeInTheDocument()
  })

  it('shows an expired message with a link back when there is no token', async () => {
    search.value = {}
    const screen = await render(<ResetPassword />)

    await expect
      .element(screen.getByText(/^Reset link expired$/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: /^Request a new link$/i }))
      .toBeInTheDocument()
  })

  it('shows an expired message when the token is flagged invalid', async () => {
    search.value = { token: 'spent-token', error: 'INVALID_TOKEN' }
    const screen = await render(<ResetPassword />)

    await expect
      .element(screen.getByText(/^Reset link expired$/i))
      .toBeInTheDocument()
    const forms = await screen.getByTestId('reset-password-form').all()
    expect(forms.length).toBe(0)
  })
})
