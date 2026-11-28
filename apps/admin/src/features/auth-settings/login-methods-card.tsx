import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import {
  normalizeLoginMethods,
  type LoginMethod,
  type LoginMethods,
} from '@/features/auth/branding'

/**
 * Sign-in methods (login round 2) — the Settings → Auth &
 * Integrations card that edits the ONE `login_methods` setting
 * (a JSON SystemSetting row, edited here via
 * `systemSettingsApi.set`, read pre-login by the admin sign-in
 * form from `GET /system-settings/branding`).
 *
 * Presentational: the parent owns the stored value and the save;
 * this card only emits the next value via onChange. The value is
 * normalized on the way in, so a stale stored blob can never put
 * the UI in an impossible state (e.g. a disabled default).
 *
 * Rules enforced here (mirroring normalizeLoginMethods):
 * - The last enabled method cannot be turned off — a tenant must
 *   never lock every staff member out of the admin. Its switch is
 *   disabled while it is the sole enabled method.
 * - Turning off the current default moves the default to the first
 *   remaining enabled method.
 * - Phone OTP is shown but DISABLED: there is no SMS provider yet,
 *   so it cannot be turned on from here (the stored value is
 *   forced off server-side too).
 */
export function LoginMethodsCard({
  value,
  onChange,
}: {
  value: LoginMethods
  onChange: (next: LoginMethods) => void
}) {
  const methods = normalizeLoginMethods(value)
  const enabledCount =
    (methods.password ? 1 : 0) + (methods.emailOtp ? 1 : 0)

  function toggle(method: 'password' | 'emailOtp', checked: boolean) {
    if (!checked && enabledCount <= 1 && methods[method]) return
    const next: LoginMethods = { ...methods, [method]: checked }
    if (!checked && methods.default === method) {
      // The default was just turned off — move it to the first
      // remaining enabled method.
      next.default = next.password ? 'password' : 'emailOtp'
    }
    onChange(next)
  }

  function setDefault(def: LoginMethod) {
    if (def === 'phoneOtp') return
    if (!methods[def]) return
    onChange({ ...methods, default: def })
  }

  const methodRows: {
    key: 'password' | 'emailOtp' | 'phoneOtp'
    label: string
    description: string
    enabled: boolean
    disabled: boolean
    disabledNote?: string
  }[] = [
    {
      key: 'password',
      label: 'Email + Password',
      description: 'Sign in with an email address and password.',
      enabled: methods.password,
      disabled: methods.password && enabledCount <= 1,
    },
    {
      key: 'emailOtp',
      label: 'Email OTP',
      description:
        'Sign in with a 6-digit code sent to the email — no password needed.',
      enabled: methods.emailOtp,
      disabled: methods.emailOtp && enabledCount <= 1,
    },
    {
      key: 'phoneOtp',
      label: 'Phone OTP',
      description: 'Sign in with a 6-digit code sent by SMS.',
      enabled: false,
      disabled: true,
      disabledNote: 'Not available yet — phone OTP needs an SMS provider.',
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>Sign-in methods</CardTitle>
        <CardDescription>
          Choose which ways staff can sign in to the admin, and which one
          opens by default on the sign-in page.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='space-y-4'>
          {methodRows.map((row) => (
            <div
              key={row.key}
              className='flex items-start justify-between gap-4'
            >
              <div className='space-y-0.5'>
                <Label htmlFor={`login-method-${row.key}`}>{row.label}</Label>
                <p className='text-sm text-muted-foreground'>
                  {row.description}
                </p>
                {row.disabledNote ? (
                  <p className='text-sm text-muted-foreground'>
                    {row.disabledNote}
                  </p>
                ) : null}
              </div>
              <Switch
                id={`login-method-${row.key}`}
                aria-label={`${row.label} sign-in`}
                checked={row.enabled}
                disabled={row.disabled}
                onCheckedChange={(checked) =>
                  row.key === 'phoneOtp'
                    ? undefined
                    : toggle(row.key, checked)
                }
              />
            </div>
          ))}
        </div>
        <div className='space-y-2'>
          <Label>Default sign-in method</Label>
          <p className='text-sm text-muted-foreground'>
            The method that opens by default on the sign-in page.
          </p>
          <RadioGroup
            value={methods.default}
            onValueChange={(v) => setDefault(v as LoginMethod)}
            className='gap-2 pt-1'
          >
            <div className='flex items-center gap-2'>
              <RadioGroupItem
                value='password'
                id='login-default-password'
                disabled={!methods.password}
              />
              <Label htmlFor='login-default-password'>Email + Password</Label>
            </div>
            <div className='flex items-center gap-2'>
              <RadioGroupItem
                value='emailOtp'
                id='login-default-emailOtp'
                disabled={!methods.emailOtp}
              />
              <Label htmlFor='login-default-emailOtp'>Email OTP</Label>
            </div>
            <div className='flex items-center gap-2'>
              <RadioGroupItem value='phoneOtp' id='login-default-phoneOtp' disabled />
              <Label htmlFor='login-default-phoneOtp'>Phone OTP</Label>
            </div>
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  )
}
