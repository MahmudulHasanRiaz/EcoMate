import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CircleAlert } from 'lucide-react'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

/**
 * Tenant admin sign-in (login redesign Step 1): Clerk-style compact
 * widget — one 400px card, a single-line title, minimal copy. The
 * tenant brand header lives in AuthLayout; this card only carries the
 * form. All banners from the old card are kept (?error= social
 * failure, ?expired=1 session expiry, ?customer=1 customer bounce,
 * ?registered=1 new customer account).
 */
export function SignIn() {
  const { redirect, expired, customer, registered, error } = useSearch({
    from: '/(auth)/sign-in',
  })

  return (
    <AuthLayout>
      <Card className='w-full max-w-[400px] gap-4 rounded-[3px]'>
        <CardHeader className='px-5 pb-0'>
          <CardTitle className='text-base tracking-tight'>Sign in</CardTitle>
          <CardDescription>
            Sign in to your account. Don&apos;t have an account?{' '}
            <Link
              to='/sign-up'
              className='auth-link text-nowrap underline underline-offset-4'
            >
              Sign Up
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className='px-5'>
          {error && (
            <div
              role='alert'
              className='mb-4 flex items-start gap-2 rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            >
              <CircleAlert className='h-4 w-4 mt-0.5 shrink-0' />
              <span>
                {error === 'access_denied'
                  ? 'Social sign-in was cancelled. Please try again or sign in with email.'
                  : 'Social sign-in failed. Please try again or sign in with email.'}
              </span>
            </div>
          )}
          {expired === '1' && (
            <div
              role='status'
              className='mb-4 flex items-start gap-2 rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            >
              <CircleAlert className='h-4 w-4 mt-0.5 shrink-0' />
              <span>Your session has expired. Please sign in again.</span>
            </div>
          )}
          {customer === '1' && (
            <div
              role='alert'
              className='mb-4 flex items-start gap-2 rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            >
              <CircleAlert className='h-4 w-4 mt-0.5 shrink-0' />
              <span>
                You are signed in with a customer account. Customer accounts
                cannot access the admin application.
              </span>
            </div>
          )}
          {registered === '1' && (
            <div
              role='status'
              className='mb-4 flex items-start gap-2 rounded-[3px] border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
            >
              <CircleAlert className='h-4 w-4 mt-0.5 shrink-0' />
              <span>
                Account created successfully! Your account is a customer
                account — sign in to the storefront to shop. Customer accounts
                cannot access the admin application.
              </span>
            </div>
          )}
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
        <CardFooter className='border-t px-5 pt-3'>
          <p className='mx-auto text-center text-xs text-muted-foreground'>
            Secured by EcoMate ·{' '}
            <a
              href='/terms'
              className='underline underline-offset-4 hover:text-primary'
            >
              Terms of Service
            </a>{' '}
            ·{' '}
            <a
              href='/privacy'
              className='underline underline-offset-4 hover:text-primary'
            >
              Privacy Policy
            </a>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
