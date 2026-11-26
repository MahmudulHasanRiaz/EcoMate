import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { authClient } from '@/lib/better-auth-client'
import {
  baErrorMessage,
  isTwoFactorRequiredError,
} from '@/lib/ba-auth-errors'
import { apiClient } from '@/lib/api-client'
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
import { SocialSignIn } from './social-sign-in'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email.' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .min(6, 'Password must be at least 6 characters long.'),
})

const challengeSchema = z.object({
  code: z
    .string()
    .min(6, 'Please enter the 6-digit code.')
    .max(6, 'Please enter the 6-digit code.'),
})

const backupCodeSchema = z.object({
  code: z.string().min(1, 'Please enter a recovery code.'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

/**
 * Admin sign-in — Phase 3 central Better Auth cutover.
 *
 * Email sign-in goes through `authClient.signIn.email()` (same-origin
 * `/api/better-auth/*` proxy → central service). There is no access token
 * to store: the BA session cookie is the credential.
 *
 * After sign-in the tenant profile (role + permissions) is read from the
 * backend `GET /auth/me` — the central session user carries no tenant
 * role/permissions — and a `customer` is signed straight back out with the
 * same inline banner the old 403 produced (the customer bounce out of
 * admin is unchanged behaviour; the layout enforces it again as a second
 * layer).
 *
 * A TOTP-enabled user gets FORBIDDEN { code: "TWO_FACTOR_REQUIRED" } with
 * no session (Phase 1 Q11) — the form switches to the challenge screen
 * instead of erroring out.
 */
export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [customerBlocked, setCustomerBlocked] = useState('')
  const [stage, setStage] = useState<'password' | 'challenge'>('password')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const challengeForm = useForm<z.infer<typeof challengeSchema>>({
    resolver: zodResolver(challengeSchema),
    defaultValues: { code: '' },
  })

  const backupForm = useForm<z.infer<typeof backupCodeSchema>>({
    resolver: zodResolver(backupCodeSchema),
    defaultValues: { code: '' },
  })

  const challengeCode = challengeForm.watch('code')

  /**
   * The session cookie is set — confirm the tenant profile, enforce the
   * customer bounce, and land in the app. Runs after password sign-in AND
   * after a successful TOTP challenge.
   */
  async function completeSignIn() {
    let me: {
      id: string
      email: string
      role: string
      permissions?: string[]
      firstName?: string
      lastName?: string
      username?: string
    }
    try {
      const res = await apiClient.get('/auth/me')
      me = res.data?.user || res.data
      if (!me || !me.id) throw new Error('empty profile')
    } catch {
      // Fail closed: a session whose tenant profile cannot be read must
      // never land in the shell.
      await authClient.signOut().catch(() => {})
      toast.error('Could not load your account. Please try again.')
      return
    }

    if (me.role === 'customer') {
      await authClient.signOut().catch(() => {})
      auth.reset()
      setCustomerBlocked(
        'You are signed in with a customer account. Customer accounts cannot access the admin application.',
      )
      setStage('password')
      return
    }

    auth.setUser({
      id: me.id,
      email: me.email,
      role: me.role,
      permissions: me.permissions || [],
      firstName: me.firstName,
      lastName: me.lastName,
      username: me.username,
    })
    auth.setSignedIn(true)

    const targetPath = redirectTo || '/'
    navigate({ to: targetPath, replace: true })
    toast.success(`Welcome back!`)
  }

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    setCustomerBlocked('')

    try {
      // Retry on network errors (ECONNREFUSED during backend startup race)
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          const { error } = await authClient.signIn.email({
            email: data.email,
            password: data.password,
          })
          if (error) {
            if (isTwoFactorRequiredError(error)) {
              setStage('challenge')
              return
            }
            throw error
          }
          await completeSignIn()
          return
        } catch (error: any) {
          // Only retry on network errors (no HTTP response from the service:
          // the BA client error carries no `status` then, and a bare fetch
          // throw has none either). A real 4xx/5xx must never be retried.
          const status = error?.status ?? error?.body?.status
          if (attempt < 3 && !status) {
            const delay = 500 * Math.pow(2, attempt)
            console.warn(`[login] Retry ${attempt + 1}/3 in ${delay}ms`)
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          throw error
        }
      }
    } catch (error: any) {
      toast.error(baErrorMessage(error, 'Sign-in failed. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  async function onChallengeSubmit(data: z.infer<typeof challengeSchema>) {
    setIsLoading(true)
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: data.code,
        trustDevice: true,
      })
      if (error) {
        const message = baErrorMessage(error, 'Invalid code. Please try again.')
        challengeForm.setError('code', { message })
        toast.error(message)
        return
      }
      await completeSignIn()
    } catch {
      toast.error('Could not verify the code. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  async function onBackupCodeSubmit(data: z.infer<typeof backupCodeSchema>) {
    setIsLoading(true)
    try {
      const { error } = await authClient.twoFactor.verifyBackupCode({
        code: data.code.trim(),
      })
      if (error) {
        const message = baErrorMessage(
          error,
          'Invalid recovery code. Please try again.',
        )
        backupForm.setError('code', { message })
        toast.error(message)
        return
      }
      await completeSignIn()
    } catch {
      toast.error('Could not verify the recovery code. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (stage === 'challenge') {
    return (
      <div className={cn('grid gap-3', className)}>
        <p className='text-sm text-muted-foreground'>
          Two-factor authentication is on for this account. Enter the 6-digit
          code from your authenticator app to continue.
        </p>
        {!useBackupCode ? (
          <Form {...challengeForm}>
            <form
              onSubmit={challengeForm.handleSubmit(onChallengeSubmit)}
              className='grid gap-2'
            >
              <FormField
                control={challengeForm.control}
                name='code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='sr-only'>Authentication code</FormLabel>
                    <FormControl>
                      <InputOTP
                        maxLength={6}
                        {...field}
                        containerClassName='justify-between sm:[&>[data-slot="input-otp-group"]>div]:w-12'
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
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                className='mt-2'
                disabled={challengeCode.length < 6 || isLoading}
              >
                {isLoading ? <Loader2 className='animate-spin' /> : null}
                Verify and sign in
              </Button>
            </form>
          </Form>
        ) : (
          <Form {...backupForm}>
            <form
              onSubmit={backupForm.handleSubmit(onBackupCodeSubmit)}
              className='grid gap-2'
            >
              <FormField
                control={backupForm.control}
                name='code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recovery code</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete='one-time-code'
                        placeholder='XXXXX-XXXXX'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className='mt-2' disabled={isLoading}>
                {isLoading ? <Loader2 className='animate-spin' /> : null}
                Verify and sign in
              </Button>
            </form>
          </Form>
        )}
        <div className='flex items-center justify-between text-sm'>
          <button
            type='button'
            onClick={() => setUseBackupCode((v) => !v)}
            className='font-medium text-muted-foreground underline underline-offset-4 hover:text-primary'
          >
            {useBackupCode
              ? 'Use authenticator code instead'
              : 'Use a recovery code instead'}
          </button>
          <button
            type='button'
            onClick={() => {
              setStage('password')
              setUseBackupCode(false)
            }}
            className='font-medium text-muted-foreground underline underline-offset-4 hover:text-primary'
          >
            Back to sign-in
          </button>
        </div>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        {customerBlocked && (
          <div
            role='alert'
            className='flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
          >
            <CircleAlert className='h-4 w-4 mt-0.5 shrink-0' />
            <span>{customerBlocked}</span>
          </div>
        )}
        {/*
          R-BITWARDEN: explicit autocomplete tokens on the login fields.
          Without them, password managers (Bitwarden) cannot identify the
          form and warn that the page is "interfering" — the console had
          the same gap until fix round #1. username + current-password
          is the standard login pairing.
        */}
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type='email'
                  autoComplete='username'
                  placeholder='name@example.com'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem className='relative'>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='current-password'
                  placeholder='********'
                  {...field}
                />
              </FormControl>
              <FormMessage />
              <Link
                to='/forgot-password'
                className='absolute inset-e-0 -top-0.5 text-sm font-medium text-muted-foreground hover:opacity-75'
              >
                Forgot password?
              </Link>
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Sign in
        </Button>
        <SocialSignIn redirectTo={redirectTo} />
      </form>
    </Form>
  )
}
