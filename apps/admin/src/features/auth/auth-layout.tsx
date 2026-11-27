import { useEffect, type CSSProperties } from 'react'
import { usePublicBranding } from './use-public-branding'
import { DEFAULT_BRAND_COLORS, resolveBrandMark } from './branding'
import { TenantBrandMark } from './tenant-brand-mark'
import { mediaUrl } from '@/lib/utils'
import './auth-widget.css'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Shared shell for the public auth pages (sign-in incl. OTP/TOTP,
 * sign-up, forgot-password, reset-password). Clerk-style compact
 * widget (login redesign Step 1): one centered 400px card, a compact
 * header (tenant tile + name + ONE tagline line — no large
 * "Welcome back"), and a side gap on every screen so the card floats
 * in the middle instead of filling the page edge-to-edge.
 *
 * The header shows the TENANT's own brand — store logo, admin favicon,
 * or an initials tile from the store name — fetched unauthenticated
 * from `GET /system-settings/branding`. The tenant's brand COLOURS
 * from the same endpoint are applied as scoped CSS vars
 * (`--auth-brand*`) on this wrapper only: the auth widget reads them,
 * the global `--primary` (#4f6bf2) is never touched, so the logged-in
 * admin keeps its fixed brand. While branding loads (or when the
 * tenant has no brand at all) the generic EcoMate mark + "Admin" and
 * the storefront-default colours are shown, so the header never
 * flashes a wrong brand.
 *
 * While an auth page is open the browser tab follows the tenant too:
 * the tab favicon becomes the admin favicon and the title becomes
 * "<Store> · Admin". Both are restored when the layout unmounts
 * (sign-in lands in the app shell).
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  const { branding } = usePublicBranding()
  const mark = resolveBrandMark(branding)
  const colors = branding?.colors ?? DEFAULT_BRAND_COLORS

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

  // Scoped brand vars: read by ./auth-widget.css inside this wrapper
  // only. Never assigned to the global --primary.
  const brandVars = {
    '--auth-brand': colors.primary,
    '--auth-brand-dark': colors.primaryDark,
    '--auth-accent': colors.accent,
    '--auth-border': colors.border,
    '--auth-danger': colors.danger,
    '--auth-success': colors.success,
  } as CSSProperties

  return (
    <div
      className='auth-widget mx-auto grid h-svh w-full max-w-none items-center justify-center px-4 sm:px-8'
      style={brandVars}
    >
      <div className='mx-auto flex w-full max-w-[400px] flex-col justify-center gap-2 py-8'>
        <div className='mb-3 flex flex-col items-center gap-1.5 text-center'>
          <TenantBrandMark mark={mark} />
          <h1 className='text-base font-medium tracking-tight'>
            {mark.name || 'Admin'}
          </h1>
          {mark.name ? (
            <p className='text-xs text-muted-foreground'>{mark.tagline}</p>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  )
}
