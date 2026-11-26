import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, CircleCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import { APP_BASEPATH } from '@/lib/app-href'
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

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email.' : undefined),
  }),
})

/**
 * Forgot password — Phase 3 (D7=B): BA native reset LINKS replace the OTP
 * flow. `requestPasswordReset` emails a link (valid 15 minutes) that lands
 * on `/reset-password?token=…`; there is no code to type and no `/otp`
 * page anymore. The response is generic by design (anti-enumeration) —
 * the same confirmation shows whether or not the email exists.
 */
export function ForgotPasswordForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const [isLoading, setIsLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    try {
      const { error } = await authClient.requestPasswordReset({
        email: data.email,
        redirectTo: `${window.location.origin}${APP_BASEPATH}/reset-password`,
      })
      if (error) throw error
    } catch {
      // Anti-enumeration: never reveal whether the email exists. A failed
      // request shows the same confirmation as a successful one.
      toast.success('If the email exists, a reset link has been sent')
    }
    form.reset()
    setSentTo(data.email)
    setIsLoading(false)
  }

  if (sentTo) {
    return (
      <div className={cn('grid gap-3', className)}>
        <div
          role='status'
          className='flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
        >
          <CircleCheck className='h-4 w-4 mt-0.5 shrink-0' />
          <span>
            If an account exists for {sentTo}, a password reset link is on
            its way. The link expires in 15 minutes — check your inbox (and
            spam folder).
          </span>
        </div>
        <Button
          type='button'
          variant='outline'
          onClick={() => setSentTo(null)}
        >
          Send to a different email
        </Button>
      </div>
    )
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
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          Send reset link
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
