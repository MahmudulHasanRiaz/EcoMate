import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import {
  baErrorMessage,
  getBaErrorCode,
} from '@/lib/ba-auth-errors'
import { copyToClipboard } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'

/**
 * Two-factor authentication (TOTP) for tenant staff — D13=B.
 *
 * Enrolment: confirm password → `twoFactor.enable` returns the TOTP URI +
 * the one-time backup codes → scan the QR, verify a code to confirm the
 * authenticator works, save the backup codes. Recovery: regenerate a fresh
 * set (old codes die) or disable with password confirmation.
 *
 * Empty-set note (Phase 2 §7 item 4): migrated users' backup codes arrive
 * as an encrypted EMPTY set — no codes exist until fresh ones are issued
 * here (Phase 4's first-login screen does the same for users who never
 * open this tab). The recovery section therefore treats "enabled, no codes
 * shown yet" as a normal state with a generate button, never as an error.
 */
export function SecurityTab() {
  const { data: session, refetch: refetchSession } = authClient.useSession()
  const sessionEnabled = (session?.user as { twoFactorEnabled?: boolean } | undefined)
    ?.twoFactorEnabled
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null)
  const enabled = enabledOverride ?? sessionEnabled ?? false

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [enrol, setEnrol] = useState<{ totpURI: string; backupCodes: string[] } | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [codesSaved, setCodesSaved] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')

  async function handleEnable() {
    if (!password) {
      toast.error('Please enter your password to confirm it is you.')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await authClient.twoFactor.enable({ password })
      if (error) {
        if (getBaErrorCode(error) === 'TOTP_ALREADY_ENABLED') {
          setEnabledOverride(true)
          toast.info('Two-factor authentication is already on for this account.')
        } else {
          toast.error(baErrorMessage(error, 'Could not start two-factor setup.'))
        }
        return
      }
      if (!data || data.method !== 'totp') {
        toast.error('Could not start two-factor setup. Please try again.')
        return
      }
      setEnrol({ totpURI: data.totpURI, backupCodes: data.backupCodes })
      setCodes(data.backupCodes)
      setCodesSaved(false)
      setPassword('')
    } catch {
      toast.error('Could not start two-factor setup. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify() {
    if (verifyCode.length < 6) return
    setBusy(true)
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: verifyCode,
      })
      if (error) {
        toast.error(baErrorMessage(error, 'Invalid code. Please try again.'))
        return
      }
      setVerified(true)
      setEnabledOverride(true)
      await refetchSession().catch(() => {})
      toast.success('Two-factor authentication is on.')
    } catch {
      toast.error('Could not verify the code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRegenerate() {
    if (!password) {
      toast.error('Please enter your password to confirm it is you.')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({
        password,
      })
      if (error) throw error
      setCodes(data?.backupCodes ?? [])
      setCodesSaved(false)
      setPassword('')
      toast.success('New recovery codes generated. The old ones no longer work.')
    } catch (error: any) {
      toast.error(baErrorMessage(error, 'Could not generate recovery codes.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    if (!disablePassword) {
      toast.error('Please enter your password to confirm it is you.')
      return
    }
    setBusy(true)
    try {
      const { error } = await authClient.twoFactor.disable({
        password: disablePassword,
      })
      if (error) throw error
      setEnabledOverride(false)
      setEnrol(null)
      setCodes(null)
      setDisableOpen(false)
      setDisablePassword('')
      await refetchSession().catch(() => {})
      toast.success('Two-factor authentication is off.')
    } catch (error: any) {
      toast.error(baErrorMessage(error, 'Could not turn off two-factor authentication.'))
    } finally {
      setBusy(false)
    }
  }

  // The otpauth URI carries the secret — show it as text too, for apps that
  // accept manual entry.
  const totpSecret = enrol ? new URL(enrol.totpURI).searchParams.get('secret') ?? '' : ''

  return (
    <div className='grid gap-4'>
      <Card className='rounded-md'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            {enabled ? (
              <ShieldCheck className='h-4 w-4 text-indigo-600' />
            ) : (
              <ShieldOff className='h-4 w-4 text-muted-foreground' />
            )}
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            {enabled
              ? 'Your account asks for a 6-digit code from your authenticator app after your password.'
              : 'Add a second step to sign-in: a 6-digit code from an authenticator app (Google Authenticator, 1Password, or similar) after your password.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {!enabled && !enrol && (
            <>
              <p className='text-sm text-muted-foreground'>
                You will scan a QR code with your authenticator app, then
                enter one code to confirm it works. Keep the recovery codes
                somewhere safe — they are the only way back in if you lose
                your phone.
              </p>
              <div className='grid gap-2 sm:max-w-sm'>
                <label htmlFor='totp-password' className='text-sm font-medium'>
                  Confirm your password
                </label>
                <PasswordInput
                  id='totp-password'
                  autoComplete='current-password'
                  placeholder='********'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  className='mt-1 w-fit'
                  disabled={busy || !password}
                  onClick={handleEnable}
                >
                  {busy ? <Loader2 className='animate-spin' /> : null}
                  Set up two-factor authentication
                </Button>
              </div>
            </>
          )}

          {!enabled && enrol && (
            <>
              <div className='grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start'>
                <div className='rounded-md border border-border bg-white p-3'>
                  <QRCodeSVG value={enrol.totpURI} size={160} />
                </div>
                <div className='grid gap-2'>
                  <p className='text-sm'>
                    Scan this code with your authenticator app. If your app
                    cannot scan, enter this secret manually:
                  </p>
                  <div className='flex items-center gap-2'>
                    <code className='min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs'>
                      {totpSecret}
                    </code>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => copyToClipboard(totpSecret, 'Secret')}
                    >
                      <Copy className='h-3.5 w-3.5' /> Copy
                    </Button>
                  </div>
                  <p className='text-sm text-muted-foreground'>
                    Two-factor authentication is already on — verifying a code
                    below just confirms your app was set up correctly.
                  </p>
                </div>
              </div>

              <RecoveryCodes
                codes={codes}
                saved={codesSaved}
                onSaved={() => setCodesSaved(true)}
              />

              <div className='grid gap-2 sm:max-w-sm'>
                <label htmlFor='totp-verify' className='text-sm font-medium'>
                  Enter a code from your authenticator app
                </label>
                <InputOTP
                  id='totp-verify'
                  maxLength={6}
                  value={verifyCode}
                  onChange={setVerifyCode}
                  containerClassName='justify-start'
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                <Button
                  className='mt-1 w-fit'
                  disabled={busy || verifyCode.length < 6 || verified}
                  onClick={handleVerify}
                >
                  {busy ? <Loader2 className='animate-spin' /> : null}
                  {verified ? 'Verified' : 'Verify and finish setup'}
                </Button>
                {verified && (
                  <p role='status' className='flex items-center gap-1.5 text-sm text-indigo-700 dark:text-indigo-300'>
                    <Check className='h-4 w-4' /> Your authenticator works.
                    Keep the recovery codes above somewhere safe.
                  </p>
                )}
              </div>
            </>
          )}

          {enabled && (
            <>
              <p role='status' className='flex items-center gap-1.5 text-sm text-indigo-700 dark:text-indigo-300'>
                <Check className='h-4 w-4' /> Two-factor authentication is on.
              </p>

              {codes ? (
                <RecoveryCodes
                  codes={codes}
                  saved={codesSaved}
                  onSaved={() => setCodesSaved(true)}
                />
              ) : (
                <div className='grid gap-2 rounded-md border border-border p-3'>
                  <p className='text-sm font-medium'>Recovery codes</p>
                  <p className='text-sm text-muted-foreground'>
                    No recovery codes are saved here yet. Codes are shown
                    only once, when they are created — accounts moved to the
                    new sign-in system arrived without any. Generate a set
                    now and store it somewhere safe.
                  </p>
                  <div className='grid gap-2 sm:max-w-sm'>
                    <label htmlFor='totp-regen-password' className='text-sm font-medium'>
                      Confirm your password
                    </label>
                    <PasswordInput
                      id='totp-regen-password'
                      autoComplete='current-password'
                      placeholder='********'
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button
                      className='mt-1 w-fit'
                      variant='outline'
                      disabled={busy || !password}
                      onClick={handleRegenerate}
                    >
                      {busy ? <Loader2 className='animate-spin' /> : null}
                      Generate recovery codes
                    </Button>
                  </div>
                </div>
              )}

              {!disableOpen ? (
                <div>
                  <Button
                    variant='outline'
                    disabled={busy}
                    onClick={() => setDisableOpen(true)}
                  >
                    Turn off two-factor authentication
                  </Button>
                </div>
              ) : (
                <div className='grid gap-2 rounded-md border border-border p-3'>
                  <p className='text-sm font-medium'>
                    Turn off two-factor authentication?
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    Your account will sign in with just a password again. Any
                    unused recovery codes stop working.
                  </p>
                  <div className='grid gap-2 sm:max-w-sm'>
                    <label
                      htmlFor='totp-disable-password'
                      className='text-sm font-medium'
                    >
                      Confirm your password
                    </label>
                    <PasswordInput
                      id='totp-disable-password'
                      autoComplete='current-password'
                      placeholder='********'
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                    />
                    <div className='mt-1 flex gap-2'>
                      <Button
                        variant='outline'
                        disabled={busy || !disablePassword}
                        onClick={handleDisable}
                      >
                        {busy ? <Loader2 className='animate-spin' /> : null}
                        Turn off
                      </Button>
                      <Button
                        variant='outline'
                        disabled={busy}
                        onClick={() => {
                          setDisableOpen(false)
                          setDisablePassword('')
                        }}
                      >
                        Keep it on
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RecoveryCodes({
  codes,
  saved,
  onSaved,
}: {
  codes: string[] | null
  saved: boolean
  onSaved: () => void
}) {
  if (!codes) return null
  return (
    <div className='grid gap-2 rounded-md border border-border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-sm font-medium'>Recovery codes</p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            copyToClipboard(codes.join('\n'), 'Recovery codes')
          }
        >
          <Copy className='h-3.5 w-3.5' /> Copy all
        </Button>
      </div>
      <p className='text-sm text-muted-foreground'>
        Save these now — each code works once, and they are never shown again.
      </p>
      <ul className='grid grid-cols-2 gap-1.5 font-mono text-xs sm:grid-cols-5'>
        {codes.map((code) => (
          <li
            key={code}
            className='rounded-md bg-muted px-2 py-1.5 text-center'
          >
            {code}
          </li>
        ))}
      </ul>
      <label className='flex cursor-pointer items-center gap-2 text-sm'>
        <input
          type='checkbox'
          checked={saved}
          onChange={(e) => {
            if (e.target.checked) onSaved()
          }}
          className='h-4 w-4 accent-indigo-600'
        />
        I saved these codes somewhere safe
      </label>
    </div>
  )
}
