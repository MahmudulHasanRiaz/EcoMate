import { useEffect } from 'react'
import { usePublicBranding } from './use-public-branding'
import { resolveBrandMark } from './branding'
import { TenantBrandMark } from './tenant-brand-mark'
import { mediaUrl } from '@/lib/utils'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Shared shell for the public auth pages (sign-in incl. OTP/TOTP,
 * sign-up, forgot-password, reset-password). The header shows the
 * TENANT's own brand — store logo, admin favicon, or an initials tile
 * from the store name — fetched unauthenticated from
 * `GET /system-settings/branding`. While it loads (or when the tenant
 * has no brand at all) the generic EcoMate mark + "Admin" is shown,
 * so the header never flashes a wrong brand.
 *
 * While an auth page is open the browser tab follows the tenant too:
 * the tab favicon becomes the admin favicon and the title becomes
 * "<Store> · Admin". Both are restored when the layout unmounts
 * (sign-in lands in the app shell).
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  const { branding } = usePublicBranding()
  const mark = resolveBrandMark(branding)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const favicon = branding?.adminFavicon?.trim()
    const name = mark.name
    if (!favicon && !name) return
    const prevTitle = document.title
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    )
    const prevHrefs = links.map((link) => link.getAttribute('href'))
    if (favicon) {
      const url = mediaUrl(favicon)
      links.forEach((link) => link.setAttribute('href', url))
    }
    if (name) document.title = `${name} · Admin`
    return () => {
      links.forEach((link, i) => {
        const prev = prevHrefs[i]
        if (prev === null) link.removeAttribute('href')
        else link.setAttribute('href', prev)
      })
      document.title = prevTitle
    }
  }, [branding, mark.name])

  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex flex-col items-center gap-2 text-center'>
          <TenantBrandMark mark={mark} />
          <div>
            <h1 className='text-xl font-medium tracking-tight'>
              {mark.name || 'Admin'}
            </h1>
            {mark.name ? (
              <p className='text-sm text-muted-foreground'>{mark.tagline}</p>
            ) : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
