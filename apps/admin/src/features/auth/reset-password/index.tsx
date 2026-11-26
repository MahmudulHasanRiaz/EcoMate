import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { ResetPasswordForm } from './components/reset-password-form'

export function ResetPassword() {
  // BA native reset LINK fallback (D7=B, Phase 3): the emailed link lands
  // here as `/reset-password?token=…` (or `?error=INVALID_TOKEN` when the
  // token is spent). The token lives in the URL by design — the service
  // mints a single-use token for exactly this page.
  //
  // D7 flip (2026-11-26): the forgot-password UI no longer sends links —
  // it sends a 6-digit OTP code instead. This page stays only for links
  // already emailed; without a token it points at the OTP flow.
  const { token, error } = useSearch({ from: '/(auth)/reset-password' })
  const resetToken = token && !error ? token : undefined

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4 sm:min-w-sm'>
        {resetToken ? (
          <>
            <CardHeader>
              <CardTitle className='text-lg tracking-tight'>
                Reset Password
              </CardTitle>
              <CardDescription>
                Choose a new password for your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResetPasswordForm token={resetToken} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className='text-lg tracking-tight'>
                Reset link expired
              </CardTitle>
              <CardDescription>
                This reset link is no longer valid. It may have expired, or
                it was already used — please request a new code instead.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <p className='mx-auto px-8 text-center text-sm text-balance text-muted-foreground'>
                <Link
                  to='/forgot-password'
                  className='underline underline-offset-4 hover:text-primary'
                >
                  Request a new code
                </Link>
                .
              </p>
            </CardFooter>
          </>
        )}
      </Card>
    </AuthLayout>
  )
}
