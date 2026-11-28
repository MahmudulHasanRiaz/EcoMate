import { useSearch } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { CircleAlert } from 'lucide-react'
import { AuthLayout } from '../auth-layout'
import { AuthBrandHeader } from '../auth-brand-header'
import { AuthCardFooter } from '../auth-card-footer'
import { UserAuthForm } from './components/user-auth-form'

/**
 * Tenant admin sign-in (login redesign Step 1, polished to
 * Clerk-clean): ONE compact 400px card, and nothing else on the
 * page. The brand header (AuthBrandHeader — the store's own mark,
 * exactly as the storefront header renders it) is the FIRST thing
 * inside the card, like Clerk's logo + "Sign in to Clerk"; there is
 * no "Sign in" heading block and no sign-up line in the header.
 * "Don't have an account? Sign up" lives ONLY in the footer strip
 * above "Secured by EcoMate". The Terms / Privacy links live in the
 * PAGE footer (AuthLayout), never in this card.
 *
 * All banners from the old card are kept (?error= social failure,
 * ?expired=1 session expiry, ?customer=1 customer bounce,
 * ?registered=1 new customer account). On ?error=access_denied the
 * custom-domain social hint also shows under the social row — that
 * hint never shows on the default view.
 */
export function SignIn() {
  const { redirect, expired, customer, registered, error } = useSearch({
    from: '/(auth)/sign-in',
  })

  return (
    <AuthLayout>
      <Card className='w-full max-w-[400px] gap-4 rounded-[3px]'>
        <CardContent className='px-5'>
          <div className='mb-4'>
            <AuthBrandHeader />
          </div>
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
          <UserAuthForm
            redirectTo={redirect}
            showCustomDomainHint={error === 'access_denied'}
          />
        </CardContent>
        <AuthCardFooter showSignUp />
      </Card>
    </AuthLayout>
  )
}
