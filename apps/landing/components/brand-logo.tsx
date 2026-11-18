import Link from 'next/link';
import { fetchBranding } from '@/lib/branding';

/**
 * Brand mark for the site header. Renders the operator-managed logo
 * image (GET /public/branding, with env fallback) when one is
 * configured, otherwise the platform-initial lettermark. Styled on the
 * v3 mk-logo classes. Async server component — the fetch is cached
 * (5-minute revalidate, 'branding' tag) so it costs nothing per page.
 */
export async function BrandLogo() {
  const { platformName, logoUrl } = await fetchBranding();
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
