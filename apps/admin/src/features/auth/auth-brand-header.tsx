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
 * (see TenantBrandMark). There is NO tagline line under the name:
 * the store name alone is the header (Boss, login round 2 — the
 * "Admin Dashboard" line under the name was just extra text, on the
 * admin login and on the storefront alike, so it is gone here and
 * is not replaced by any other line). The generic fallback (no
 * branding at all) shows the EcoMate mark + 'Admin'.
 */
export function AuthBrandHeader() {
  const { branding } = usePublicBranding()
  const mark = resolveBrandMark(branding)

  return (
    <div className='flex flex-col items-center gap-1.5 text-center'>
      <TenantBrandMark mark={mark} />
      {mark.kind === 'generic' ? (
        <h1 className='text-base font-medium tracking-tight'>Admin</h1>
      ) : null}
    </div>
  )
}
