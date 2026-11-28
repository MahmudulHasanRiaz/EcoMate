import { usePublicBranding } from './use-public-branding'
import { resolveBrandMark } from './branding'
import { TenantBrandMark } from './tenant-brand-mark'

/**
 * Login polish: the brand header lives INSIDE the auth card, at its
 * very top and centered — like Clerk's logo + "Sign in to Clerk"
 * inside the card. Nothing brand-related sits above the card on the
 * page anymore (AuthLayout renders only the card + the page footer).
 *
 * What it shows is the storefront header's own rendering for this
 * tenant (`branding.display`, systems[0].display — the single source
 * of truth): logo alone, favicon + name side by side, or name alone
 * (see TenantBrandMark). Under the mark, one short subtitle line —
 * the admin tagline ('Admin Dashboard' by default) — except in
 * 'logo' mode, where the logo already carries the brand and the
 * tagline alone would read as a stray line; the generic fallback
 * (no branding at all) shows the EcoMate mark + 'Admin'.
 */
export function AuthBrandHeader() {
  const { branding } = usePublicBranding()
  const mark = resolveBrandMark(branding)

  return (
    <div className='flex flex-col items-center gap-1.5 text-center'>
      <TenantBrandMark mark={mark} />
      {mark.kind === 'logo' || mark.kind === 'generic' ? null : mark.name ? (
        <p className='text-xs text-muted-foreground'>{mark.tagline}</p>
      ) : null}
      {mark.kind === 'generic' ? (
        <h1 className='text-base font-medium tracking-tight'>Admin</h1>
      ) : null}
    </div>
  )
}
