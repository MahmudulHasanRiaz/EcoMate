import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { PasswordInput } from '@/components/password-input'

// Mirrors the backend StrongPasswordConstraint
// (apps/backend/src/auth/validators/password.validator.ts) exactly, so the
// user gets the failure here instead of a round-trip: min 8 chars, one
// uppercase, one lowercase, one number, one special character.
const formSchema = z
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

// The backend's exact BadRequest message for an expired/invalid reset JWT
// (auth.service.ts resetPassword). Only this failure offers a way back to
// the start of the flow — a weak-password failure must not.
const EXPIRED_TOKEN_MESSAGE = 'Invalid or expired reset token'

type ResetPasswordFormProps = React.HTMLAttributes<HTMLFormElement> & {
  /** 5-minute reset JWT minted by POST /auth/verify-otp. */
  token: string
}

export function ResetPasswordForm({
  token,
  className,
  ...props
}: ResetPasswordFormProps) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    setServerError(null)

    try {
      await apiClient.post('/auth/reset-password', {
        token,
        password: data.password,
      })
      toast.success('Password has been reset successfully')
      navigate({ to: '/sign-in' })
    } catch (error: any) {
      const raw = error.response?.data?.message
      const message =
        (Array.isArray(raw) ? raw.join(' ') : raw) ||
        'Could not reset your password. Please try again.'
      setServerError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-2', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>New Password</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='new-password'
                  placeholder='********'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm New Password</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='new-password'
                  placeholder='********'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {serverError && (
          <p role='alert' className='text-sm text-destructive'>
            <span>{serverError}</span>
            {serverError === EXPIRED_TOKEN_MESSAGE && (
              <>
                {' '}
                <Link
                  to='/forgot-password'
                  className='underline underline-offset-4 hover:text-primary'
                >
                  Request a new code.
                </Link>
              </>
            )}
          </p>
        )}
        <Button className='mt-2' disabled={isLoading}>
          Reset Password
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
