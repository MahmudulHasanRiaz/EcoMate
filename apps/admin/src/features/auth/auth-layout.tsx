import { useEffect, type CSSProperties } from 'react'
import { usePublicBranding } from './use-public-branding'
import { DEFAULT_BRAND_COLORS, resolveBrandMark } from './branding'
import { mediaUrl } from '@/lib/utils'
import './auth-widget.css'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Shared shell for the public auth pages (sign-in incl. OTP/TOTP,
 * sign-up, forgot-password, reset-password). Clerk-style compact
 * widget (login redesign Step 1, polished): one centered 400px card
 * that floats on the page — the brand header lives INSIDE the card
 * (AuthBrandHeader, first child of each card), and NOTHING sits above
 * the card on the page.
 *
 * The page footer sits at the very bottom of the PAGE, below the
 * card — "© <year> <store> · Terms of Service · Privacy Policy",
 * like Clerk's page footer. The Terms / Privacy links live here only,
 * never inside a card (the sign-in card keeps only its "Secured by
 * EcoMate" strip).
 *
 * The header shows the TENANT's own brand — rendered exactly like the
 * storefront header for the same tenant (logo alone, favicon + name,
 * or name alone, from `branding.display`) — fetched unauthenticated
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
      className='auth-widget flex min-h-svh w-full flex-col px-4 sm:px-8'
      style={brandVars}
    >
      <div className='flex flex-1 items-center justify-center py-8'>
        <div className='w-full max-w-[400px]'>{children}</div>
      </div>
      <footer className='pb-5 pt-2 text-center text-xs text-muted-foreground'>
        © {new Date().getFullYear()} {mark.name || 'EcoMate'} ·{' '}
        <a href='/terms' className='underline underline-offset-4'>
          Terms of Service
        </a>{' '}
        ·{' '}
        <a href='/privacy' className='underline underline-offset-4'>
          Privacy Policy
        </a>
      </footer>
    </div>
  )
}
