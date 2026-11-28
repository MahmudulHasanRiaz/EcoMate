import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import {
  SOCIAL_PROVIDERS,
  socialCallbackUrls,
  type SocialProviderId,
} from '@/lib/ba-auth-errors'
import { Button } from '@/components/ui/button'

/**
 * Social sign-in (login redesign Step 1, polished): icon-only row,
 * rendered ONLY from the configured providers (`SOCIAL_PROVIDERS` —
 * Google / GitHub / Facebook today). Unconfigured providers (Apple,
 * X in the preview) are never rendered as clickable buttons — a fake
 * button would be worse than no button.
 *
 * Fixed-host-set constraint: providers forbid wildcard redirect URIs, so
 * social works only on the fixed host set the service was configured with.
 * Per-tenant-subdomain callbacks are not registerable — on a custom domain
 * the provider refuses and the user signs in with email instead. That
 * hint shows ONLY when a social button actually failed
 * (`showCustomDomainHint`, set by the sign-in page on
 * `?error=access_denied`) — never on the default view, where the card
 * stays as clean as Clerk's.
 */

function GoogleMark() {
  return (
    <svg viewBox='0 0 24 24' className='size-4' aria-hidden>
      <path
        fill='#4285F4'
        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
      />
      <path
        fill='#34A853'
        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
      />
      <path
        fill='#FBBC05'
        d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
      />
      <path
        fill='#EA4335'
        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
      />
    </svg>
  )
}

function GitHubMark() {
  return (
    <svg viewBox='0 0 24 24' className='size-4 fill-current' aria-hidden>
      <path d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' />
    </svg>
  )
}

function FacebookMark() {
  return (
    <svg viewBox='0 0 24 24' className='size-4' aria-hidden>
      <path
        fill='#1877F2'
        d='M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z'
      />
    </svg>
  )
}

const PROVIDER_MARKS: Record<SocialProviderId, () => React.ReactNode> = {
  google: () => <GoogleMark />,
  github: () => <GitHubMark />,
  facebook: () => <FacebookMark />,
}

export function SocialSignIn({
  redirectTo,
  showCustomDomainHint = false,
}: {
  redirectTo?: string
  /** Show the custom-domain hint — only after a social failure. */
  showCustomDomainHint?: boolean
}) {
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null)

  async function handleSocial(provider: SocialProviderId) {
    setPendingProvider(provider)
    try {
      const { callbackURL, errorCallbackURL } = socialCallbackUrls(redirectTo)
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
      })
      if (error) {
        toast.error(
          `Could not start ${provider} sign-in. Please try email sign-in instead.`,
        )
        setPendingProvider(null)
      }
      // On success the browser leaves for the provider — no further UI here.
    } catch {
      toast.error(
        `Could not start ${provider} sign-in. Please try email sign-in instead.`,
      )
      setPendingProvider(null)
    }
  }

  return (
    <div className='grid gap-3'>
      <div className='flex items-center justify-center gap-2' role='group' aria-label='Continue with social account'>
        {SOCIAL_PROVIDERS.map((p) => {
          const Mark = PROVIDER_MARKS[p.id]
          const pending = pendingProvider === p.id
          return (
            <Button
              key={p.id}
              type='button'
              variant='outline'
              size='icon'
              disabled={pendingProvider !== null}
              aria-label={`Continue with ${p.label}`}
              title={`Continue with ${p.label}`}
              className='auth-social'
              onClick={() => handleSocial(p.id)}
            >
              {pending ? (
                <Loader2 className='size-4 animate-spin' aria-hidden />
              ) : (
                <Mark />
              )}
            </Button>
          )
        })}
      </div>
      <div className='flex items-center gap-3 text-xs text-muted-foreground'>
        <span className='h-px flex-1 bg-border' aria-hidden />
        <span>or</span>
        <span className='h-px flex-1 bg-border' aria-hidden />
      </div>
      {showCustomDomainHint && (
        <p className='text-center text-xs text-muted-foreground'>
          Social sign-in works on your store&apos;s main address. On a
          custom domain, use email sign-in instead.
        </p>
      )}
    </div>
  )
}
