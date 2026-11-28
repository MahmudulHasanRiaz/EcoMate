import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { AuthBrandHeader } from '../auth-brand-header'
import { AuthCardFooter } from '../auth-card-footer'
import { ForgotPasswordForm } from './components/forgot-password-form'

/**
 * Forgot password (login redesign Step 1, polished): same compact
 * 400px widget as sign-in, brand header inside the card, one-line
 * copy. The form itself runs three steps in the widget — email, code,
 * new password. The card keeps only the "Secured by EcoMate" strip;
 * Terms / Privacy live in the page footer (AuthLayout).
 */
export function ForgotPassword() {
  return (
    <AuthLayout>
      <Card className='w-full max-w-[400px] gap-4 rounded-[3px]'>
        <CardContent className='px-5'>
          <div className='mb-4'>
            <AuthBrandHeader />
          </div>
          <CardHeader className='px-0 pb-0'>
            <CardTitle className='text-base tracking-tight'>
              Forgot password
            </CardTitle>
            <CardDescription>
              Enter your email and we&apos;ll send you a 6-digit code.
            </CardDescription>
          </CardHeader>
          <div className='mt-4'>
            <ForgotPasswordForm />
          </div>
        </CardContent>
        <AuthCardFooter />
      </Card>
    </AuthLayout>
  )
}
