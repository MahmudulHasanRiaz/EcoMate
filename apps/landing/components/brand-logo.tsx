import Link from 'next/link';
import { getBranding } from '@/lib/branding';

/**
 * Brand mark for the site header. Renders the configured logo image when
 * NEXT_PUBLIC_LOGO_URL is set (and safe — see lib/branding.ts), otherwise
 * the text mark. The platform branding setting (logoUrl) has no public
 * endpoint yet; until it does, the logo comes from env.
 */
export function BrandLogo() {
  const { platformName, logoUrl } = getBranding();
  return (
    <Link className="brand" href="/">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="brand-logo" src={logoUrl} alt={platformName} />
      ) : (
        <span className="brand-mark" aria-hidden />
      )}
      {platformName}
    </Link>
  );
}
