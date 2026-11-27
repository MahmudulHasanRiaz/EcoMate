import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, CircleCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import { baErrorMessage } from '@/lib/ba-auth-errors'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { PasswordStrengthMeter } from '../../password-strength-meter'
import { useResendCooldown } from '../../use-resend-cooldown'

const emailSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email.' : undefined),
  }),
})

const codeSchema = z.object({
  otp: z
    .string()
    .min(6, 'Please enter the 6-digit code.')
    .max(6, 'Please enter the 6-digit code.'),
})

// Mirrors the backend StrongPasswordConstraint
// (apps/backend/src/auth/validators/password.validator.ts) exactly, so the
// user gets the failure here instead of a round-trip: min 8 chars, one
// uppercase, one lowercase, one number, one special character.
const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long.')
      .regex(/[A-Z]/, 'Password must include an uppercase letter.')
      .regex(/[a-z]/, 'Password must include a lowercase letter.')
      .regex(/[0-9]/, 'Password must include a number.')
      .regex(
        /[!@#$%^&*()_+\-=[\]{}|;':",./<>?]/,
        'Password must include a special character.',
      ),
    confirmPassword: z.string().min(1, 'Please confirm your new password.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  })

type Step = 'email' | 'code' | 'password'

/**
 * Forgot password — D7 flip (2026-11-26): OTP flow replaces the Phase 3
 * BA native reset LINKS. Email → 6-digit code (`emailOtp.requestPasswordReset`)
 * → new password (`emailOtp.resetPassword`). The code is valid 15 minutes;
 * 5 wrong tries lock that code (TOO_MANY_ATTEMPTS) — request a new one.
 * The response is generic by design (anti-enumeration) — the same
 * confirmation shows whether or not the email exists.
 *
 * Login redesign (Step 1): the flow is split into three visible steps in
 * one widget — email, then the code on its own step, then the new
 * password (with a strength meter). The code is verified together with
 * the password submit (the service has no verify-only call); a wrong
 * code surfaces there, with a link back to the code step. The old
 * link-based `/reset-password?token=…` page stays as a fallback for
 * links already emailed, but no UI sends a link anymore.
 */
export function ForgotPasswordForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<Step>('email')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const resendCooldown = useResendCooldown(30)
  const navigate = useNavigate()

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })

  const codeForm = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { otp: '' },
  })

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  const otpCode = codeForm.watch('otp')
  const newPassword = passwordForm.watch('password')

  async function onEmailSubmit(data: z.infer<typeof emailSchema>) {
    setIsLoading(true)

    try {
      const { error } = await authClient.emailOtp.requestPasswordReset({
        email: data.email,
      })
      if (error) throw error
    } catch {
      // Anti-enumeration: never reveal whether the email exists. A failed
      // request shows the same confirmation as a successful one.
      toast.success('If the email exists, a reset code has been sent')
    }
    emailForm.reset()
    setSentTo(data.email)
    setCode('')
    codeForm.reset()
    resendCooldown.start()
    setStep('code')
    setIsLoading(false)
  }

  async function onResend() {
    if (!sentTo) return
    setIsLoading(true)
    try {
      // Resend rotates: a fresh code is issued and the previous one stops
      // working (resendStrategy "rotate", service-side).
      const { error } = await authClient.emailOtp.requestPasswordReset({
        email: sentTo,
      })
      if (error) throw error
      resendCooldown.start()
      toast.success('A new code has been sent to your email')
    } catch {
      toast.success('If the email exists, a reset code has been sent')
    } finally {
      setIsLoading(false)
    }
  }

  function onCodeSubmit(data: z.infer<typeof codeSchema>) {
    setCode(data.otp)
    setServerError(null)
    setStep('password')
  }

  async function onPasswordSubmit(data: z.infer<typeof passwordSchema>) {
    if (!sentTo) return
    setIsLoading(true)
    setServerError(null)

    try {
      const { error } = await authClient.emailOtp.resetPassword({
        email: sentTo,
        otp: code,
        password: data.password,
      })
      if (error) throw error
      toast.success('Password has been reset successfully')
      navigate({ to: '/sign-in' })
    } catch (error: any) {
      const message = baErrorMessage(
        error,
        'Could not reset your password. Please try again.',
      )
      setServerError(message)
      toast.error(message)
      setShake(true)
    } finally {
      setIsLoading(false)
    }
  }

  function backToEmail() {
    setStep('email')
    setSentTo(null)
    setServerError(null)
    setCode('')
    codeForm.reset()
    passwordForm.reset()
  }

  const otpSlots = (
    <>
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
    </>
  )

  if (step === 'code') {
    return (
      <div
        className={cn('auth-step grid gap-3', className)}
        onAnimationEnd={() => setShake(false)}
      >
        <div
          role='status'
          className='flex items-start gap-2 rounded-[3px] border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
        >
          <CircleCheck className='h-4 w-4 mt-0.5 shrink-0' />
          <span>
            If an account exists for {sentTo}, a 6-digit reset code is on
            its way. The code expires in 15 minutes — check your inbox (and
            spam folder).
          </span>
        </div>
        <Form {...codeForm}>
          <form
            onSubmit={codeForm.handleSubmit(onCodeSubmit)}
            className='grid gap-2'
          >
            <FormField
              control={codeForm.control}
              name='otp'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset code</FormLabel>
                  <FormControl>
                    <InputOTP
                      maxLength={6}
                      {...field}
                      containerClassName='justify-between'
                    >
                      {otpSlots}
                    </InputOTP>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              className='auth-btn auth-btn-primary mt-2'
              disabled={isLoading || otpCode.length < 6}
            >
              Continue
              {isLoading ? (
                <Loader2 className='animate-spin' />
              ) : (
                <ArrowRight />
              )}
            </Button>
          </form>
        </Form>
        <div className='flex items-center justify-between text-sm'>
          <button
            type='button'
            onClick={onResend}
            disabled={isLoading || resendCooldown.remaining > 0}
            className='auth-link min-h-0 font-medium underline underline-offset-4 disabled:opacity-50'
          >
            {resendCooldown.remaining > 0
              ? `Resend code (${resendCooldown.remaining}s)`
              : 'Resend code'}
          </button>
          <button
            type='button'
            onClick={backToEmail}
            className='auth-link min-h-0 font-medium underline underline-offset-4'
          >
            Send to a different email
          </button>
        </div>
      </div>
    )
  }

  if (step === 'password') {
    return (
      <div
        className={cn('auth-step grid gap-3', shake && 'auth-shake', className)}
        onAnimationEnd={() => setShake(false)}
      >
        <p className='text-sm text-muted-foreground'>
          Choose a new password for {sentTo}.
        </p>
        <Form {...passwordForm}>
          <form
            onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
            className='grid gap-2'
          >
            <FormField
              control={passwordForm.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete='new-password'
                      placeholder='********'
                      className='auth-field'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  <PasswordStrengthMeter password={newPassword} />
                </FormItem>
              )}
            />
            <FormField
              control={passwordForm.control}
              name='confirmPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete='new-password'
                      placeholder='********'
                      className='auth-field'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {serverError && (
              <p role='alert' className='text-sm text-destructive'>
                {serverError}{' '}
                <button
                  type='button'
                  onClick={() => {
                    setStep('code')
                    setServerError(null)
                  }}
                  className='auth-link font-medium underline underline-offset-4'
                >
                  Check the code again.
                </button>
              </p>
            )}
            <Button className='auth-btn auth-btn-primary mt-2' disabled={isLoading}>
              Reset Password
              {isLoading ? (
                <Loader2 className='animate-spin' />
              ) : (
                <ArrowRight />
              )}
            </Button>
          </form>
        </Form>
        <button
          type='button'
          onClick={() => setStep('code')}
          className='auth-link min-h-0 self-start text-sm font-medium underline underline-offset-4'
        >
          Back to the code
        </button>
      </div>
    )
  }

  return (
    <Form {...emailForm}>
      <form
        onSubmit={emailForm.handleSubmit(onEmailSubmit)}
        className={cn('auth-step grid gap-2', className)}
        {...props}
      >
        <FormField
          control={emailForm.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                {/* R-BITWARDEN: explicit type + autocomplete so password
                    managers can identify the field (see sign-in form). */}
                <Input
                  type='email'
                  autoComplete='email'
                  placeholder='name@example.com'
                  className='auth-field'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='auth-btn auth-btn-primary mt-2' disabled={isLoading}>
          Send reset code
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
