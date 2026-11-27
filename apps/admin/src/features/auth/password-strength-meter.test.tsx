import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  PasswordStrengthMeter,
  passwordStrength,
} from './password-strength-meter'

/**
 * Login redesign (Step 1): the meter mirrors the backend
 * StrongPasswordConstraint exactly (min 8, upper, lower, number,
 * special), so it can never disagree with the server-side rules.
 */

describe('passwordStrength (pure)', () => {
  it('scores 0 for an empty password', () => {
    expect(passwordStrength('')).toEqual({ score: 0, passed: [] })
  })

  it('scores each rule independently', () => {
    expect(passwordStrength('abcdefgh').score).toBe(2) // length + lowercase
    expect(passwordStrength('Abcdefg1').score).toBe(4) // + upper + number
    expect(passwordStrength('Abcdefg1!').score).toBe(5)
  })

  it('names the passed rules', () => {
    expect(passwordStrength('Abcdefg1!').passed).toEqual([
      'length',
      'uppercase',
      'lowercase',
      'number',
      'special',
    ])
  })
})

describe('PasswordStrengthMeter', () => {
  it('renders nothing for an empty password', async () => {
    const { container } = await render(
      <PasswordStrengthMeter password='' />,
    )
    expect(container.textContent).toBe('')
  })

  it('shows the strength label, bar and rule checklist', async () => {
    const screen = await render(
      <PasswordStrengthMeter password='Abcdefg1!' />,
    )

    await expect.element(screen.getByText('Strong')).toBeInTheDocument()
    await expect
      .element(screen.getByText('At least 8 characters'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('A special character'))
      .toBeInTheDocument()
    const bar = screen.container.querySelector('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('aria-valuenow')).toBe('5')
  })

  it('labels a short password Weak', async () => {
    const screen = await render(<PasswordStrengthMeter password='abc' />)
    await expect.element(screen.getByText('Weak')).toBeInTheDocument()
  })
})
