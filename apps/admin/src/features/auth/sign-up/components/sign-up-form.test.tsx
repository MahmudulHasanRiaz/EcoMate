import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { SignUpForm } from './sign-up-form'

const FORM_MESSAGES = {
  emailEmpty: 'Please enter your email.',
  passwordEmpty: 'Password must be at least 6 characters long.',
  confirmPasswordEmpty: 'Please confirm your password.',
  passwordMismatch: "Passwords don't match.",
} as const

/**
 * Phase 3: registration goes through `authClient.signUp.email()` (BA
 * client), then the tenant profile fields are saved best-effort via
 * `apiClient.put('/auth/me', ...)`. The old test held the submission open
 * with a deferred `apiClient.post` — but `onSubmit` never calls `post`,
 * so the deferred never held anything open and the real, unmocked
 * `signUp.email` hit the network instead: the Vite `/api` proxy fails
 * ECONNREFUSED with no backend running, and whether the button was
 * observed disabled depended on how fast that failure landed — green
 * locally (slow proxy connect) and red in CI (instant refusal). Mock the
 * calls `onSubmit` actually makes, and hold the submission open on the
 * sign-up call itself, so the disabled window is deterministic. Same
 * pattern as `user-auth-form.test.tsx`.
 */
const navigate = vi.hoisted(() => vi.fn())
const signUpEmail = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const putProfile = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    signUp: { email: signUpEmail },
    signOut,
  },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { put: putProfile },
}))

const toastPromise = vi.hoisted(() =>
  vi.fn((p: Promise<unknown>, opts: { success?: () => unknown }) => {
    p.then(() => opts.success?.())
  })
)

vi.mock('sonner', () => ({ toast: { promise: toastPromise, success: vi.fn(), error: vi.fn() } }))

describe('SignUpForm', () => {
  let screen: RenderResult
  let emailInput: Locator
  let passwordInput: Locator
  let confirmPasswordInput: Locator
  let submitButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    signUpEmail.mockResolvedValue({ error: null })
    putProfile.mockResolvedValue({})
    signOut.mockResolvedValue(undefined)

    screen = await render(<SignUpForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    passwordInput = screen.getByLabelText(/^Password$/i)
    confirmPasswordInput = screen.getByLabelText(/^Confirm Password$/i)
    submitButton = screen.getByRole('button', { name: /^Create Account$/i })
  })

  it('renders fields and submit button', async () => {
    await expect.element(emailInput).toBeInTheDocument()
    await expect.element(passwordInput).toBeInTheDocument()
    await expect.element(confirmPasswordInput).toBeInTheDocument()
    await expect.element(submitButton).toBeInTheDocument()
  })

  it('shows validation messages when submitting empty form', async () => {
    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText(FORM_MESSAGES.emailEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.confirmPasswordEmpty))
      .toBeInTheDocument()
  })

  it('shows a mismatch error when passwords do not match', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.fill(passwordInput, '1234567')
    await userEvent.fill(confirmPasswordInput, '7654321')

    await userEvent.click(submitButton)
    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordMismatch))
      .toBeInTheDocument()
  })

  it('disables submit while submitting and re-enables after completion', async () => {
    let resolveDeferred!: (value: unknown) => void
    const deferred = new Promise((resolve) => { resolveDeferred = resolve })
    signUpEmail.mockReturnValue(deferred as any)

    const firstNameInput = screen.getByRole('textbox', { name: /First Name/i })
    const lastNameInput = screen.getByRole('textbox', { name: /Last Name/i })
    const usernameInput = screen.getByRole('textbox', { name: /Username/i })
    const phoneNumberInput = screen.getByRole('textbox', { name: /Phone Number/i })

    await userEvent.fill(firstNameInput, 'John')
    await userEvent.fill(lastNameInput, 'Doe')
    await userEvent.fill(usernameInput, 'johndoe')
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.fill(phoneNumberInput, '+1234567890')
    await userEvent.fill(passwordInput, '1234567')
    await userEvent.fill(confirmPasswordInput, '1234567')

    await userEvent.click(submitButton)
    await expect.element(submitButton).toBeDisabled()
    expect(signUpEmail).toHaveBeenCalled()

    resolveDeferred({ error: null })
    await vi.waitFor(async () => {
      await expect.element(submitButton).toBeEnabled()
    })
    // The held-open sign-up resolves, so the rest of the success path
    // must run: profile save, sign-out, then redirect to sign-in.
    expect(putProfile).toHaveBeenCalledWith('/auth/me', {
      firstName: 'John',
      lastName: 'Doe',
      phoneNumber: '+1234567890',
    })
    expect(signOut).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { registered: '1' },
      replace: true,
    })
  })
})
