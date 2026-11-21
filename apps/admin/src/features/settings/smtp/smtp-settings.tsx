import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiClient } from '@/lib/api-client'
import { useFeatures } from '@/context/features-provider'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmailBalanceBanner } from './email-balance-banner'
import {
  emailsForAmount,
  expiryPreviewLine,
  formatExpiryDate,
  rateLabel,
  type SmtpSettingsResponse,
} from './lib'

interface SmtpValues {
  mode: 'BYO' | 'SAAS'
  enabled: boolean
  host: string
  port: string
  username: string
  password: string
  encryption: 'NONE' | 'STARTTLS' | 'SSL'
  fromEmail: string
  fromName: string
}

const DEFAULT_VALUES: SmtpValues = {
  mode: 'SAAS',
  enabled: true,
  host: '',
  port: '587',
  username: '',
  password: '',
  encryption: 'STARTTLS',
  fromEmail: '',
  fromName: '',
}

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
  const message = axiosErr?.response?.data?.message
  if (typeof message === 'string' && message) return message
  if (Array.isArray(message) && message.length > 0) return message.join(', ')
  return fallback
}

export function SmtpSettings() {
  // SMTP is a separate add-on (Boss point 1): the route already
  // redirects without smtp_server, but the entitlements store hydrates
  // from a localStorage cache — this component-level check is the
  // belt-and-braces layer for a stale cache, and it keeps the query
  // from firing (the API 403s without the feature).
  const { hasFeature, loading: featuresLoading } = useFeatures()
  const hasSmtp = hasFeature('smtp_server')
  const queryClient = useQueryClient()
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['smtp-settings-v2'],
    queryFn: () =>
      apiClient.get<SmtpSettingsResponse>('/settings/smtp').then((r) => r.data),
    staleTime: 30_000,
    enabled: !featuresLoading && hasSmtp,
  })

  const [values, setValues] = useState<SmtpValues>(DEFAULT_VALUES)
  const [originalValues, setOriginalValues] =
    useState<SmtpValues>(DEFAULT_VALUES)
  const [clearPassword, setClearPassword] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [topUpAmount, setTopUpAmount] = useState('')
  const [isToppingUp, setIsToppingUp] = useState(false)
  const [topUpResult, setTopUpResult] = useState<{
    invoiceNumber: string
    emailsGranted: number
  } | null>(null)

  useEffect(() => {
    if (!settingsData) return
    const extracted: SmtpValues = {
      mode: settingsData.mode,
      enabled: settingsData.enabled,
      host: settingsData.host ?? '',
      port: settingsData.port != null ? String(settingsData.port) : '587',
      username: settingsData.username ?? '',
      // Password is write-only: the field always starts empty; typing
      // replaces the stored password, leaving it blank keeps it.
      password: '',
      encryption: settingsData.encryption,
      fromEmail: settingsData.fromEmail ?? '',
      fromName: settingsData.fromName ?? '',
    }
    setValues(extracted)
    setOriginalValues(extracted)
    setClearPassword(false)
  }, [settingsData])

  const setValue = <K extends keyof SmtpValues>(key: K, value: SmtpValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (key === 'password') setClearPassword(false)
  }

  const dirtyKeys = (Object.keys(values) as (keyof SmtpValues)[]).filter(
    (k) => values[k] !== originalValues[k],
  )
  const isDirty = dirtyKeys.length > 0 || clearPassword
  const dirtyCount = dirtyKeys.length + (clearPassword ? 1 : 0)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const key of dirtyKeys) {
        if (key === 'port') {
          const port = Number(values.port)
          if (values.port.trim() !== '' && (!Number.isInteger(port) || port < 1 || port > 65535)) {
            toast.error('SMTP port must be a number between 1 and 65535')
            setIsSaving(false)
            return
          }
          payload.port = values.port.trim() === '' ? null : port
        } else if (key === 'password') {
          // Only send a typed password; an untouched (empty) field keeps
          // the stored one.
          if (values.password !== '') payload.password = values.password
        } else {
          payload[key] = values[key]
        }
      }
      if (clearPassword) payload.password = ''
      await apiClient.put('/settings/smtp', payload)
      setOriginalValues({ ...values, password: '' })
      setValues((prev) => ({ ...prev, password: '' }))
      setClearPassword(false)
      await queryClient.invalidateQueries({ queryKey: ['smtp-settings-v2'] })
      toast.success('SMTP settings saved')
    } catch (err) {
      // A failed BYO verification lands here with the specific cause
      // (auth, refused, TLS) — the mode stays as it was server-side
      // and the form keeps the typed values so they can be fixed.
      toast.error(errorMessage(err, 'Failed to save SMTP settings'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setValues({ ...originalValues })
    setClearPassword(false)
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      const { data } = await apiClient.post<{ delivered: boolean; to: string }>(
        '/settings/smtp/test',
        testTo.trim() ? { to: testTo.trim() } : {},
      )
      toast.success(`Test email sent to ${data.to}`)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to send test email'))
    } finally {
      setIsTesting(false)
    }
  }

  const handleTopUp = async () => {
    const amount = Number(topUpAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than 0')
      return
    }
    setIsToppingUp(true)
    try {
      const { data } = await apiClient.post<{
        invoiceNumber: string
        emailsGranted: number
      }>('/settings/smtp/topup', { amountBDT: amount })
      setTopUpResult({
        invoiceNumber: data.invoiceNumber,
        emailsGranted: data.emailsGranted,
      })
      setTopUpAmount('')
      toast.success('Top-up invoice created')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to create the top-up'))
    } finally {
      setIsToppingUp(false)
    }
  }

  if (featuresLoading || isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[200px]'>
        <Loader2 className='animate-spin h-6 w-6 text-primary' />
      </div>
    )
  }

  if (!hasSmtp) {
    return (
      <div className='flex flex-col items-center gap-4 py-16 text-center'>
        <div className='rounded-full bg-amber-100 dark:bg-amber-900/30 p-4'>
          <Mail className='h-10 w-10 text-amber-600 dark:text-amber-400' />
        </div>
        <h1 className='text-2xl font-bold'>Email Sending Not Available</h1>
        <p className='text-muted-foreground max-w-md'>
          Custom SMTP configuration requires a plan upgrade. Your store has
          no email balance, SMTP settings, or top-up until the SMTP add-on
          is enabled.
        </p>
        <div className='flex gap-4 mt-2'>
          <Button variant='outline' asChild>
            <Link to='/'>Go to Dashboard</Link>
          </Button>
          <Button asChild>
            <Link to='/mon/settings/plan'>View Plan &amp; Usage</Link>
          </Button>
        </div>
      </div>
    )
  }

  const balance = settingsData?.balance ?? null
  const rate = balance?.topUp ?? null
  const topUpAmountNum = Number(topUpAmount)
  const previewEmails =
    rate && Number.isFinite(topUpAmountNum) && topUpAmountNum > 0
      ? emailsForAmount(topUpAmountNum, rate.unit, rate.pricePerUnit)
      : 0
  const hasPassword = settingsData?.hasPassword ?? false

  const BYO_FIELDS: Record<
    string,
    { label: string; type: 'text' | 'password' | 'email'; hint?: string; placeholder?: string }
  > = {
    host: { label: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com' },
    port: { label: 'SMTP Port', type: 'text', placeholder: '587' },
    username: { label: 'Username', type: 'text', placeholder: 'user@example.com' },
    password: {
      label: 'Password',
      type: 'password',
      placeholder: hasPassword
        ? 'Stored password — leave blank to keep it'
        : 'Enter password',
    },
    fromEmail: { label: 'From Email', type: 'email', placeholder: 'noreply@example.com' },
    fromName: { label: 'From Name', type: 'text', placeholder: 'Your store name' },
  }

  return (
    <div className='space-y-6'>
      <EmailBalanceBanner />

      <SectionShell
        id='smtp'
        title='Email sending'
        description='Choose how your store sends order emails and customer notifications.'
        isDirty={isDirty}
        isSaving={isSaving}
        dirtyCount={dirtyCount}
        lastSavedAt={null}
        onSave={handleSave}
        onReset={handleReset}
      >
        <div className='grid gap-3 md:grid-cols-2' role='group' aria-label='Email sending mode'>
          <button
            type='button'
            aria-pressed={values.mode === 'SAAS'}
            onClick={() => setValue('mode', 'SAAS')}
            className={`rounded-lg border p-4 text-left transition-colors ${
              values.mode === 'SAAS'
                ? 'border-primary bg-muted/50'
                : 'hover:bg-muted/30'
            }`}
          >
            <p className='font-medium'>EcoMate SMTP</p>
            <p className='mt-1 text-sm text-muted-foreground'>
              Send through EcoMate&apos;s shared email service, paid from
              your email balance. No setup needed.
            </p>
          </button>
          <button
            type='button'
            aria-pressed={values.mode === 'BYO'}
            onClick={() => setValue('mode', 'BYO')}
            className={`rounded-lg border p-4 text-left transition-colors ${
              values.mode === 'BYO'
                ? 'border-primary bg-muted/50'
                : 'hover:bg-muted/30'
            }`}
          >
            <p className='font-medium'>Own SMTP</p>
            <p className='mt-1 text-sm text-muted-foreground'>
              Use your own email provider (Gmail, ZeptoMail, SendGrid, or
              any SMTP server). No charge from EcoMate.
            </p>
          </button>
        </div>

        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={values.enabled}
            onCheckedChange={(checked) => setValue('enabled', checked === true)}
          />
          Email sending enabled
        </label>
        {!values.enabled ? (
          <p className='text-sm text-muted-foreground'>
            When disabled, queued emails fail instead of sending. Turn it
            back on to resume.
          </p>
        ) : null}

        {values.mode === 'SAAS' ? (
          <div className='space-y-4'>
            {settingsData?.balanceError ? (
              <p className='rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'>
                {settingsData.balanceError}
              </p>
            ) : balance ? (
              <div className='rounded-lg border p-4'>
                <p className='text-sm text-muted-foreground'>Email balance</p>
                <p className='mt-1 text-3xl font-bold'>
                  {balance.balance.toLocaleString('en-US')}{' '}
                  <span className='text-base font-medium text-muted-foreground'>
                    {balance.balance === 1 ? 'email' : 'emails'} remaining
                  </span>
                </p>
                {balance.lowBalance && balance.balance > 0 ? (
                  <p className='mt-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300'>
                    <AlertTriangle className='h-4 w-4' />
                    Running low — top up to keep sending without a break.
                  </p>
                ) : null}
                {balance.expiringSoon.length > 0 ? (
                  <ul className='mt-3 space-y-1 text-sm text-muted-foreground'>
                    {balance.expiringSoon.map((lot) => (
                      <li key={lot.lotId}>
                        {lot.emailsRemaining.toLocaleString('en-US')}{' '}
                        {lot.emailsRemaining === 1 ? 'email' : 'emails'} expire
                        on {formatExpiryDate(lot.expiresAt)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className='grid gap-4 md:grid-cols-2'>
              <Field
                fieldKey='fromEmail'
                schema={{
                  label: 'Reply-To Email',
                  type: 'email',
                  placeholder: 'replies@example.com',
                  hint: 'Replies to your EcoMate-sent emails go here.',
                }}
                value={values.fromEmail}
                onChange={(v) => setValue('fromEmail', v)}
              />
              <Field
                fieldKey='fromName'
                schema={{
                  label: 'Sender Name',
                  type: 'text',
                  placeholder: 'Your store name',
                }}
                value={values.fromName}
                onChange={(v) => setValue('fromName', v)}
              />
            </div>
            <p className='text-sm text-muted-foreground'>
              EcoMate SMTP sends from EcoMate&apos;s shared address with
              your store name — sending from your own domain needs Own
              SMTP.
            </p>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='grid gap-4 md:grid-cols-2'>
              {Object.entries(BYO_FIELDS).map(([key, schema]) => (
                <Field
                  key={key}
                  fieldKey={key}
                  schema={schema}
                  value={values[key as keyof SmtpValues] as string}
                  onChange={(v) => setValue(key as keyof SmtpValues, v)}
                />
              ))}
              <div className='space-y-1.5'>
                <label
                  htmlFor='smtp-encryption'
                  className='text-sm font-medium'
                >
                  Encryption
                </label>
                <Select
                  value={values.encryption}
                  onValueChange={(v) =>
                    setValue('encryption', v as SmtpValues['encryption'])
                  }
                >
                  <SelectTrigger id='smtp-encryption'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='STARTTLS'>STARTTLS (port 587)</SelectItem>
                    <SelectItem value='SSL'>SSL / TLS (port 465)</SelectItem>
                    <SelectItem value='NONE'>None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {hasPassword && values.password === '' && !clearPassword ? (
              <button
                type='button'
                className='text-sm text-muted-foreground underline underline-offset-2'
                onClick={() => setClearPassword(true)}
              >
                Remove saved password
              </button>
            ) : null}
            {clearPassword ? (
              <p className='text-sm text-amber-700 dark:text-amber-300'>
                The saved password will be removed when you save.
              </p>
            ) : null}
            <p className='text-sm text-muted-foreground'>
              Switching to Own SMTP verifies the connection when you save —
              if verification fails, EcoMate SMTP stays active and the
              reason is shown.
            </p>
            <div className='flex flex-wrap items-end gap-3'>
              <div className='min-w-64 flex-1'>
                <Field
                  fieldKey='testTo'
                  schema={{
                    label: 'Send test email to',
                    type: 'email',
                    placeholder: 'Your email (leave blank for your account email)',
                  }}
                  value={testTo}
                  onChange={setTestTo}
                />
              </div>
              <Button
                variant='outline'
                onClick={handleTest}
                disabled={isTesting}
              >
                {isTesting ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className='mr-2 h-4 w-4' />
                    Send test email
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </SectionShell>

      {values.mode === 'SAAS' ? (
        <SectionShell
          id='smtp'
          title='Top up email balance'
          description='Buy more emails. You pay per the current rate and receive an email balance — a count of sendable emails, never a money balance.'
          isDirty={false}
          isSaving={false}
          dirtyCount={0}
          lastSavedAt={null}
          onSave={() => {}}
          onReset={() => {}}
        >
          {!rate?.rateConfigured ? (
            <p className='text-sm text-muted-foreground'>
              Top-ups are not available yet — the email rate has not been
              set. Your free starter emails still work.
            </p>
          ) : (
            <div className='space-y-4'>
              <div className='max-w-xs'>
                <Field
                  fieldKey='topUpAmount'
                  schema={{
                    label: 'Amount (৳)',
                    type: 'text',
                    placeholder: '500',
                    hint: rate.minimumBDT
                      ? `Minimum ৳${rate.minimumBDT.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — the price of 1 email.`
                      : undefined,
                  }}
                  value={topUpAmount}
                  onChange={(v) => {
                    setTopUpAmount(v)
                    setTopUpResult(null)
                  }}
                />
              </div>
              {topUpAmountNum > 0 ? (
                <div className='rounded-lg border p-4 text-sm'>
                  <p>
                    You will receive{' '}
                    <strong>
                      {previewEmails.toLocaleString('en-US')}{' '}
                      {previewEmails === 1 ? 'email' : 'emails'}
                    </strong>
                    {rateLabel(rate.unit, rate.pricePerUnit)
                      ? ` at ${rateLabel(rate.unit, rate.pricePerUnit)}`
                      : ''}
                    .
                  </p>
                  <p className='mt-1 text-muted-foreground'>
                    {expiryPreviewLine(rate)}
                  </p>
                  <p className='mt-1 text-muted-foreground'>
                    Non-refundable — unused emails are not refunded.
                  </p>
                </div>
              ) : null}
              <div>
                <Button
                  onClick={handleTopUp}
                  disabled={isToppingUp || previewEmails < 1}
                >
                  {isToppingUp ? 'Creating…' : 'Create top-up invoice'}
                </Button>
              </div>
              {topUpResult ? (
                <p className='rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100'>
                  Top-up invoice {topUpResult.invoiceNumber} created for{' '}
                  {topUpResult.emailsGranted.toLocaleString('en-US')} emails.
                  Pay it from the{' '}
                  <Link
                    to='/mon/settings/billing'
                    className='font-medium underline underline-offset-2'
                  >
                    Billing page
                  </Link>{' '}
                  — the emails land in your balance once the payment is
                  approved.
                </p>
              ) : null}
            </div>
          )}
        </SectionShell>
      ) : null}
    </div>
  )
}
