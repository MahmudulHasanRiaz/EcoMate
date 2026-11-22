import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { OtpForm } from './components/otp-form'

// Seconds between resends. The backend rate-limits the auth endpoints
// (10/min for unknown clients), so a cooldown keeps honest retries well
// inside the limit instead of surfacing 429s to the user.
const RESEND_COOLDOWN_SECONDS = 30

export function Otp() {
  const { email } = useSearch({ from: '/(auth)/otp' })
  const navigate = useNavigate()
  const [cooldown, setCooldown] = useState(0)
  const [isResending, setIsResending] = useState(false)
  const redirectedRef = useRef(false)

  // Direct visits (or a stale bookmark) carry no email, and verify-otp
  // cannot work without one — send the user back to the start with an
  // in-app message instead of showing a dead form. The ref guard keeps
  // StrictMode's double-effect (dev) from showing the toast twice.
  useEffect(() => {
    if (!email && !redirectedRef.current) {
      redirectedRef.current = true
      toast.error('Please enter your email first so we can send you a code.')
      navigate({ to: '/forgot-password', replace: true })
    }
  }, [email, navigate])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function handleResend() {
    if (!email || cooldown > 0 || isResending) return
    setIsResending(true)

    try {
      await apiClient.post('/auth/forgot-password', { email })
      toast.success(`A new code was sent to ${email}`)
    } catch (error: any) {
      const raw = error.response?.data?.message
      const message =
        (Array.isArray(raw) ? raw.join(' ') : raw) ||
        'Could not resend the code. Please try again.'
      toast.error(message)
    } finally {
      // Cooldown applies after every attempt (success or failure) so a
      // rate-limited user isn't tempted to hammer the endpoint.
      setCooldown(RESEND_COOLDOWN_SECONDS)
      setIsResending(false)
    }
  }

  if (!email) return null

  return (
    <AuthLayout>
      <Card className='max-w-md gap-4'>
        <CardHeader>
          <CardTitle className='text-base tracking-tight'>
            Check your email
          </CardTitle>
          <CardDescription>
            Please enter the 6-digit code. <br /> We have sent the code to{' '}
            {email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OtpForm email={email} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            Haven&apos;t received it?{' '}
            <button
              type='button'
              onClick={handleResend}
              disabled={cooldown > 0 || isResending}
              className='underline underline-offset-4 hover:text-primary disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60'
            >
              {cooldown > 0
                ? `Resend a new code in ${cooldown}s.`
                : 'Resend a new code.'}
            </button>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
