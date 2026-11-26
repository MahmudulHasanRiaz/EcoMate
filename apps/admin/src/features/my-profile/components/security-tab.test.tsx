import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SecurityTab } from './security-tab'

/**
 * Phase 3 (D13=B): TOTP enrolment UI + recovery flows for tenant staff.
 * Migrated users' backup codes arrive as an encrypted EMPTY set
 * (Phase 2 §7 item 4) — the empty-set state must offer generation,
 * never crash.
 */

const enable = vi.hoisted(() => vi.fn())
const verifyTotp = vi.hoisted(() => vi.fn())
const generateBackupCodes = vi.hoisted(() => vi.fn())
const disable = vi.hoisted(() => vi.fn())
const refetchSession = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastInfo = vi.hoisted(() => vi.fn())
const sessionState = vi.hoisted(() => ({
  twoFactorEnabled: false as boolean,
}))

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: 'u1', twoFactorEnabled: sessionState.twoFactorEnabled } },
      refetch: refetchSession,
    }),
    twoFactor: { enable, verifyTotp, generateBackupCodes, disable },
  },
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(),
}))

const ENROL_DATA = {
  method: 'totp',
  totpURI: 'otpauth://totp/EcoMate:admin@example.com?secret=JBSWY3DPEHPK3PXP&issuer=EcoMate',
  backupCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF'],
}

describe('SecurityTab TOTP enrolment (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionState.twoFactorEnabled = false
    enable.mockResolvedValue({ data: ENROL_DATA, error: null })
    verifyTotp.mockResolvedValue({ error: null })
    generateBackupCodes.mockResolvedValue({
      data: { backupCodes: ['GGGGG-HHHHH', 'IIIII-JJJJJ'] },
      error: null,
    })
    disable.mockResolvedValue({ error: null })
    refetchSession.mockResolvedValue({})
  })

  it('enrols: password confirm → QR + secret + backup codes → verify → on', async () => {
    const screen = await render(<SecurityTab />)
    await expect
      .element(screen.getByText('Set up two-factor authentication'))
      .toBeInTheDocument()

    await userEvent.fill(screen.getByLabelText('Confirm your password'), 'pw123456')
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }))

    expect(enable).toHaveBeenCalledWith({ password: 'pw123456' })
    await expect.element(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    await expect.element(screen.getByText('AAAAA-BBBBB')).toBeInTheDocument()
    await expect.element(screen.getByText('CCCCC-DDDDD')).toBeInTheDocument()

    const otpInput = screen.container.querySelector('input[autocomplete="one-time-code"]')
    expect(otpInput).not.toBeNull()
    await userEvent.fill(otpInput as HTMLInputElement, '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and finish setup' }))

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' })
    expect(toastSuccess).toHaveBeenCalledWith('Two-factor authentication is on.')
    // A successful verify flips the tab to the enabled branch (the
    // enrolment "Your authenticator works." line unmounts with it).
    await expect.element(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument()
    await expect.element(screen.getByText('AAAAA-BBBBB')).toBeInTheDocument()
  })

  it('shows the empty-set recovery state and generates fresh codes', async () => {
    sessionState.twoFactorEnabled = true
    const screen = await render(<SecurityTab />)

    await expect
      .element(screen.getByText('No recovery codes are saved here yet. Codes are shown only once, when they are created — accounts moved to the new sign-in system arrived without any. Generate a set now and store it somewhere safe.'))
      .toBeInTheDocument()

    await userEvent.fill(screen.getByLabelText('Confirm your password'), 'pw123456')
    await userEvent.click(screen.getByRole('button', { name: 'Generate recovery codes' }))

    expect(generateBackupCodes).toHaveBeenCalledWith({ password: 'pw123456' })
    expect(toastSuccess).toHaveBeenCalledWith(
      'New recovery codes generated. The old ones no longer work.',
    )
    await expect.element(screen.getByText('GGGGG-HHHHH')).toBeInTheDocument()
  })

  it('disables 2FA with password confirmation', async () => {
    sessionState.twoFactorEnabled = true
    const screen = await render(<SecurityTab />)

    await userEvent.click(screen.getByRole('button', { name: 'Turn off two-factor authentication' }))
    // Two "Confirm your password" labels exist now (regenerate + disable
    // forms) — target the disable form's input by id.
    const disableInput = screen.container.querySelector('#totp-disable-password')
    expect(disableInput).not.toBeNull()
    await userEvent.fill(disableInput as HTMLInputElement, 'pw123456')
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(disable).toHaveBeenCalledWith({ password: 'pw123456' })
    expect(toastSuccess).toHaveBeenCalledWith('Two-factor authentication is off.')
    await expect
      .element(screen.getByText('Set up two-factor authentication'))
      .toBeInTheDocument()
  })

  it('treats TOTP_ALREADY_ENABLED as already on', async () => {
    enable.mockResolvedValue({ error: { code: 'TOTP_ALREADY_ENABLED', message: 'already on' } })
    const screen = await render(<SecurityTab />)

    await userEvent.fill(screen.getByLabelText('Confirm your password'), 'pw123456')
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }))

    expect(toastInfo).toHaveBeenCalledWith('Two-factor authentication is already on for this account.')
    await expect.element(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument()
  })

  it('requires a password before starting setup', async () => {
    const screen = await render(<SecurityTab />)
    // Button is disabled without a password — enable is never called.
    await expect
      .element(screen.getByRole('button', { name: 'Set up two-factor authentication' }))
      .toBeDisabled()
    expect(enable).not.toHaveBeenCalled()
  })
})
