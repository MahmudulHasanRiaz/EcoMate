import { Link, useLocation } from '@tanstack/react-router'
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
  // The reset JWT arrives in router state from the OTP page (never in the
  // URL, so it stays out of browser history). A direct visit or a refresh
  // has no token — the 5-minute token is spent, so restart the flow.
  const state = useLocation().state as { resetToken?: string } | undefined
  const resetToken = state?.resetToken

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
                the page was reloaded — please request a new code.
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
