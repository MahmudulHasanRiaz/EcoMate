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
  fallbackDomain?: string;
  customDomainCname: string;
  allowExternalFallback: boolean;
  /** False during a primary-domain/TLS outage: redirects use the fallback. */
  primaryHealthy: boolean;
}

export interface AliasResolution {
  slug: string;
  baseDomain: string;
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
  const fallbackDomain =
    normaliseHost(env.SAAS_FALLBACK_DOMAIN ?? '') || undefined;
  const allowExternalFallback = env.SAAS_ALLOW_EXTERNAL_FALLBACK === 'true';
  const configured = (env.SAAS_BASE_DOMAINS ?? primaryDomain)
    .split(',')
    .map(normaliseHost)
    .filter(Boolean);
  const baseDomains = configured.length > 0 ? configured : [primaryDomain];
  // An explicitly allowed external fallback resolves as an alias base too.
  if (
    fallbackDomain &&
    allowExternalFallback &&
    !baseDomains.includes(fallbackDomain)
  ) {
    baseDomains.push(fallbackDomain);
  }
  return {
    primaryDomain,
    baseDomains,
    fallbackDomain,
    customDomainCname:
      normaliseHost(env.SAAS_CUSTOM_DOMAIN_CNAME ?? '') ||
      `cname.${primaryDomain}`,
    allowExternalFallback,
    primaryHealthy: env.SAAS_PRIMARY_UNHEALTHY !== 'true',
  };
}

/**
 * True for hosts the storefront must never serve: a base domain itself, a
 * reserved platform subdomain (www/api/saas/cname/...), or the CNAME target.
 * These are handled by the platform apps (or 404 at the edge), and treating
 * them as "unknown tenant" would otherwise let the storefront render an empty
 * shell on platform hosts.
 */
export function isBaseOrPlatformHost(
  rawHost: string,
  config: TenantDomainConfig = readDomainConfig(),
): boolean {
  const host = normaliseHost(rawHost);
  if (!host) return false;
  if (host === config.customDomainCname) return true;
  for (const baseDomain of config.baseDomains) {
    if (host === baseDomain) return true;
    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) continue;
    const slug = host.slice(0, -suffix.length);
    if (RESERVED_TENANT_SLUGS.has(slug)) return true;
  }
  return false;
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
    // A dotted slug means this base matched only as a SUFFIX of a longer
    // base (e.g. `shop.ecomate.bd` ends with `.ecomate.bd`, leaving the
    // dotted slug `acme.shop`) — try the next, more-specific base instead
    // of giving up. A reserved slug is reserved on every base, so it
    // still resolves as null immediately.
    if (!slug || slug.includes('.')) continue;
    if (RESERVED_TENANT_SLUGS.has(slug)) {
      return null;
    }

    return {
      slug,
      baseDomain,
      canonicalHost: `${slug}.${config.primaryDomain}`,
      isAlias: baseDomain !== config.primaryDomain,
    };
  }

  return null;
}

export interface AliasRedirectOptions {
  /** Request protocol (`http:` / `https:`); defaults to https. */
  protocol?: string;
  /** Non-standard request port to keep (dev/E2E); production is empty. */
  port?: string;
}

/**
 * Redirect origin for a target host. A standard port for the protocol
 * (80/http, 443/https) is never emitted — even when a caller passes one —
 * so a redirect can never point at `https://{host}:443/` or carry a
 * stray internal port through a standard-port public URL.
 */
function redirectOrigin(protocol: string, host: string, port?: string): string {
  const standard =
    (protocol === 'https:' && port === '443') ||
    (protocol === 'http:' && port === '80');
  return `${protocol}//${host}${port && !standard ? `:${port}` : ''}`;
}

/**
 * Absolute 301 target for a host the AUTHORITATIVE backend verdict says is
 * an alias (`GET /tenants/resolve` → `{isAlias, canonicalHost,
 * effectiveCanonicalHost}`), or null when the verdict is canonical /
 * missing / already on the effective canonical host.
 *
 * The redirect target is the EFFECTIVE canonical host (the fallback base
 * during a primary-domain outage — the backend computes it), never the
 * raw canonical host: redirecting a fallback-host visitor to an
 * unreachable primary would break the outage behaviour. When healthy the
 * two are identical.
 *
 * This is what makes alias canonicalisation follow the PLATFORM domain
 * config even when the storefront's own env config is stale (a console
 * tenant-domain change reaches the backend via the registry sync; the
 * storefront's env only changes on redeploy). The local
 * `aliasRedirectTarget` stays as the fast path for env-known aliases.
 */
export function canonicalRedirectTarget(
  rawHost: string,
  verdict: {
    isAlias?: boolean;
    canonicalHost?: string;
    effectiveCanonicalHost?: string;
  } | null,
  pathname: string,
  search: string,
  options: AliasRedirectOptions = {},
): string | null {
  if (!verdict?.isAlias) return null;
  const targetHost = normaliseHost(
    verdict.effectiveCanonicalHost ?? verdict.canonicalHost ?? '',
  );
  if (!targetHost) return null;
  if (normaliseHost(rawHost) === targetHost) return null;

  const protocol = options.protocol || 'https:';
  const origin = redirectOrigin(protocol, targetHost, options.port);
  const target = `${pathname}${search}`;
  return `${origin}${target.startsWith('/') ? target : `/${target}`}`;
}

/**
 * Absolute 301 target for an alias host (path + query preserved), or null when
 * the request is already on the effective base / is not a tenant subdomain.
 *
 * During a primary-domain/TLS outage the effective base is the fallback, so
 * aliases do not bounce visitors to an unreachable primary and the fallback
 * host itself is served instead of redirected.
 */
export function aliasRedirectTarget(
  rawHost: string,
  pathname: string,
  search: string,
  config: TenantDomainConfig = readDomainConfig(),
  options: AliasRedirectOptions = {},
): string | null {
  const resolution = resolveBaseDomainAlias(rawHost, config);
  if (!resolution?.isAlias) return null;

  const effectiveBase =
    !config.primaryHealthy && config.fallbackDomain
      ? config.fallbackDomain
      : config.primaryDomain;
  const targetHost = `${resolution.slug}.${effectiveBase}`;
  if (normaliseHost(rawHost) === targetHost) return null;

  const protocol = options.protocol || 'https:';
  const origin = redirectOrigin(protocol, targetHost, options.port);
  const target = `${pathname}${search}`;
  return `${origin}${target.startsWith('/') ? target : `/${target}`}`;
}
