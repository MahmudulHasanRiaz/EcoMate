import Link from 'next/link';
import { getBranding } from '@/lib/branding';

/**
 * Brand mark for the site header. Renders the configured logo image when
 * NEXT_PUBLIC_LOGO_URL is set (and safe — see lib/branding.ts), otherwise
 * the platform-initial lettermark. Styled on the v3 mk-logo classes. The
 * platform branding setting (logoUrl) has a public endpoint
 * (GET /public/branding) but the landing still reads branding from env —
 * live branding is out of scope here.
 */
export function BrandLogo() {
  const { platformName, logoUrl } = getBranding();
  return (
    <Link className="mk-logo" href="/">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="mk-logo-img"
          src={logoUrl}
          alt={platformName}
          width={26}
          height={26}
        />
      ) : (
        <span className="mk-logo-mark" aria-hidden>
          {platformName.charAt(0).toUpperCase()}
        </span>
      )}
      {platformName}
    </Link>
  );
}
