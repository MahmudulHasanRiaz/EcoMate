import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { LoginMethodsCard } from './login-methods-card'
import type { LoginMethods } from '@/features/auth/branding'

/**
 * Login round 2: the sign-in methods card (Settings → Auth &
 * Integrations) edits the single `login_methods` setting. The card
 * is presentational — the parent owns saving; these tests lock the
 * values it emits.
 */

const ALL_ON: LoginMethods = {
  password: true,
  emailOtp: true,
  phoneOtp: false,
  default: 'password',
}

describe('LoginMethodsCard', () => {
  it('turning off the default method moves the default to the other enabled method', async () => {
    const onChange = vi.fn()
    const screen = await render(
      <LoginMethodsCard value={ALL_ON} onChange={onChange} />,
    )

    await userEvent.click(
      screen.getByRole('switch', { name: 'Email + Password sign-in' }),
    )
    expect(onChange).toHaveBeenCalledWith({
      password: false,
      emailOtp: true,
      phoneOtp: false,
      default: 'emailOtp',
    })
  })

  it('cannot turn off the last enabled method', async () => {
    const onChange = vi.fn()
    const screen = await render(
      <LoginMethodsCard
        value={{ ...ALL_ON, emailOtp: false }}
        onChange={onChange}
      />,
    )

    const passwordSwitch = screen.getByRole('switch', {
      name: 'Email + Password sign-in',
    })
    // Disabled switches cannot be clicked at all (userEvent would
    // wait forever for the element to enable) — asserting disabled
    // IS the lock: no click can reach onChange.
    await expect.element(passwordSwitch).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('changing the default emits the new default', async () => {
    const onChange = vi.fn()
    const screen = await render(
      <LoginMethodsCard value={ALL_ON} onChange={onChange} />,
    )

    await userEvent.click(screen.getByRole('radio', { name: 'Email OTP' }))
    expect(onChange).toHaveBeenCalledWith({ ...ALL_ON, default: 'emailOtp' })
  })

  it('phone OTP is shown but cannot be turned on or set as default', async () => {
    const onChange = vi.fn()
    const screen = await render(
      <LoginMethodsCard value={ALL_ON} onChange={onChange} />,
    )

    const phoneSwitch = screen.getByRole('switch', {
      name: 'Phone OTP sign-in',
    })
    // Disabled controls cannot be clicked (userEvent waits for
    // enablement) — asserting disabled IS the lock.
    await expect.element(phoneSwitch).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()

    const phoneRadio = screen.getByRole('radio', { name: 'Phone OTP' })
    await expect.element(phoneRadio).toBeDisabled()
    await expect
      .element(screen.getByText(/needs an SMS provider/))
      .toBeInTheDocument()
  })
})
