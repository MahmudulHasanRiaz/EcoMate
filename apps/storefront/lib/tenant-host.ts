/**
 * Storefront-side host resolution for base-domain aliases.
 *
 * The backend's `tenant-host.ts` is the source of truth for the full resolver
 * (including custom domains and platform hosts). The storefront only needs the
 * base-domain alias rule to issue the canonical 301 before rendering:
 *
 *   {slug}.{primary}          -> canonical, serve
 *   {slug}.{aliasBase}        -> 301 to {slug}.{primary}, noindex
 *   platform hosts / reserved -> not a tenant, leave untouched
 *   anything else             -> custom/unknown, leave for the tenant registry
 *
 * The reserved-slug list must stay in sync with
 * apps/backend/src/tenancy/tenant-host.ts.
 */
export const RESERVED_TENANT_SLUGS = new Set([
  'www',
  'api',
  'saas',
  'admin',
  'app',
  'status',
  'docs',
  'mail',
  'webhooks',
  'cname',
  'support',
  'blog',
]);

export interface TenantDomainConfig {
  primaryDomain: string;
  baseDomains: string[];
}

export interface AliasResolution {
  slug: string;
  canonicalHost: string;
  isAlias: boolean;
}

export function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export function readDomainConfig(
  env: NodeJS.ProcessEnv = process.env,
): TenantDomainConfig {
  const primaryDomain =
    normaliseHost(env.SAAS_PRIMARY_DOMAIN ?? '') || 'ecomate.bd';
  const configured = (env.SAAS_BASE_DOMAINS ?? primaryDomain)
    .split(',')
    .map(normaliseHost)
    .filter(Boolean);
  return {
    primaryDomain,
    baseDomains: configured.length > 0 ? configured : [primaryDomain],
  };
}

export function resolveBaseDomainAlias(
  rawHost: string,
  config: TenantDomainConfig = readDomainConfig(),
): AliasResolution | null {
  const host = normaliseHost(rawHost);
  if (!host) return null;

  for (const baseDomain of config.baseDomains) {
    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) continue;

    const slug = host.slice(0, -suffix.length);
    if (!slug || slug.includes('.') || RESERVED_TENANT_SLUGS.has(slug)) {
      return null;
    }

    return {
      slug,
      canonicalHost: `${slug}.${config.primaryDomain}`,
      isAlias: baseDomain !== config.primaryDomain,
    };
  }

  return null;
}

/**
 * Absolute 301 target for an alias host (path + query preserved), or null when
 * the request is already on the canonical host / is not a tenant subdomain.
 */
export function aliasRedirectTarget(
  rawHost: string,
  pathname: string,
  search: string,
  config: TenantDomainConfig = readDomainConfig(),
): string | null {
  const resolution = resolveBaseDomainAlias(rawHost, config);
  if (!resolution?.isAlias) return null;
  const target = `${pathname}${search}`;
  return `https://${resolution.canonicalHost}${target.startsWith('/') ? target : `/${target}`}`;
}
