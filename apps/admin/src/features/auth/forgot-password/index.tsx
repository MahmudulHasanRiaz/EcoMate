import { Link } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { ForgotPasswordForm } from './components/forgot-password-form'

/**
 * Forgot password (login redesign Step 1): same compact 400px widget
 * as sign-in, one-line copy. The form itself runs three steps in the
 * widget — email, code, new password.
 */
export function ForgotPassword() {
  return (
    <AuthLayout>
      <Card className='w-full max-w-[400px] gap-4 rounded-[3px]'>
        <CardHeader className='px-5 pb-0'>
          <CardTitle className='text-base tracking-tight'>
            Forgot password
          </CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a 6-digit code.
          </CardDescription>
        </CardHeader>
        <CardContent className='px-5'>
          <ForgotPasswordForm />
        </CardContent>
        <CardFooter className='border-t px-5 pt-3'>
          <p className='mx-auto text-center text-xs text-muted-foreground'>
            Secured by EcoMate · Don&apos;t have an account?{' '}
            <Link
              to='/sign-up'
              className='auth-link underline underline-offset-4'
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
