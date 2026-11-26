import { useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import {
  SOCIAL_PROVIDERS,
  socialCallbackUrls,
  type SocialProviderId,
} from '@/lib/ba-auth-errors'
import { Button } from '@/components/ui/button'

/**
 * Social sign-in buttons (D9=B) — Google / GitHub / Facebook, wired to the
 * central service's BA built-in OAuth config.
 *
 * Fixed-host-set constraint: providers forbid wildcard redirect URIs, so
 * social works only on the fixed host set the service was configured with.
 * Per-tenant-subdomain callbacks are not registerable — on a custom domain
 * the provider refuses and the user signs in with email instead (the
 * caption below says so plainly).
 */
export function SocialSignIn({ redirectTo }: { redirectTo?: string }) {
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
    <div className='mt-4 grid gap-3'>
      <div className='flex items-center gap-3 text-xs text-muted-foreground'>
        <span className='h-px flex-1 bg-border' aria-hidden />
        <span>or continue with</span>
        <span className='h-px flex-1 bg-border' aria-hidden />
      </div>
      <div className='grid grid-cols-3 gap-2'>
        {SOCIAL_PROVIDERS.map((p) => (
          <Button
            key={p.id}
            type='button'
            variant='outline'
            disabled={pendingProvider !== null}
            onClick={() => handleSocial(p.id)}
          >
            {pendingProvider === p.id ? 'Redirecting…' : p.label}
          </Button>
        ))}
      </div>
      <p className='text-center text-xs text-muted-foreground'>
        Social sign-in works on your store&apos;s main address. On a custom
        domain, use email sign-in instead.
      </p>
    </div>
  )
}
