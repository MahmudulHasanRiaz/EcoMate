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

/**
 * Reset password (login redesign Step 1): same compact 400px widget
 * as sign-in.
 *
 * BA native reset LINK fallback (D7=B, Phase 3): the emailed link lands
 * here as `/reset-password?token=…` (or `?error=INVALID_TOKEN` when the
 * token is spent). The token lives in the URL by design — the service
 * mints a single-use token for exactly this page.
 *
 * D7 flip (2026-11-26): the forgot-password UI no longer sends links —
 * it sends a 6-digit OTP code instead. This page stays only for links
 * already emailed; without a token it points at the OTP flow.
 */
export function ResetPassword() {
  const { token, error } = useSearch({ from: '/(auth)/reset-password' })
  const resetToken = token && !error ? token : undefined

  return (
    <AuthLayout>
      <Card className='w-full max-w-[400px] gap-4 rounded-[3px]'>
        {resetToken ? (
          <>
            <CardHeader className='px-5 pb-0'>
              <CardTitle className='text-base tracking-tight'>
                Reset password
              </CardTitle>
              <CardDescription>
                Choose a new password for your account.
              </CardDescription>
            </CardHeader>
            <CardContent className='px-5'>
              <ResetPasswordForm token={resetToken} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className='px-5 pb-0'>
              <CardTitle className='text-base tracking-tight'>
                Reset link expired
              </CardTitle>
              <CardDescription>
                This reset link is no longer valid. It may have expired, or
                it was already used — please request a new code instead.
              </CardDescription>
            </CardHeader>
            <CardFooter className='border-t px-5 pt-3'>
              <p className='mx-auto text-center text-xs text-muted-foreground'>
                <Link
                  to='/forgot-password'
                  className='auth-link underline underline-offset-4'
                >
                  Request a new code
                </Link>
              </p>
            </CardFooter>
          </>
        )}
      </Card>
    </AuthLayout>
  )
}
