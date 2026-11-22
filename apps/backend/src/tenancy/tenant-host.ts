export interface TenantDomainConfig {
  primaryDomain: string;
  baseDomains: string[];
  fallbackDomain?: string;
  customDomainCname: string;
  allowExternalFallback: boolean;
  /**
   * False during a primary-domain/TLS outage: redirects use the fallback
   * base (see TenantResolveController.effectiveCanonicalHost). Undefined
   * (older configs) means healthy. The canonical host itself never moves
   * — only redirect targets do.
   */
  primaryHealthy?: boolean;
  platformHosts: {
    landing: string;
    platformAdmin: string;
    platformApi: string;
    webhooks: string;
  };
}

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

export function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export function normaliseDomain(domain: string): string {
  return normaliseHost(domain).replace(/^www\./, '');
}

// Hostname shape: at least one dot, labels of alphanumerics/hyphens that
// neither start nor end with a hyphen. Keep in sync with
// apps/platform-api/src/config/domain-config.service.ts.
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function isValidHostname(host: string): boolean {
  return host.length > 0 && host.length <= 253 && HOSTNAME_RE.test(host);
}

/**
 * Validate a domain-config payload from the platform registry
 * (`GET /internal/tenants/registry` → `domains`) into a TenantDomainConfig.
 * Returns null when the payload is structurally unusable (missing/invalid
 * primary domain) — the caller then keeps the previous config (or the env
 * fallback) instead of breaking resolution. Lenient where safe: invalid
 * alias entries are dropped, missing platform hosts re-derive from the
 * primary/app domain, a missing CNAME target derives from the primary.
 */
export function parseTenantDomainConfig(
  input: unknown,
): TenantDomainConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const primaryDomain = normaliseDomain(
    typeof raw.primaryDomain === 'string' ? raw.primaryDomain : '',
  );
  if (!isValidHostname(primaryDomain)) return null;

  const baseDomains = Array.from(
    new Set(
      (Array.isArray(raw.baseDomains) ? raw.baseDomains : [])
        .filter((d): d is string => typeof d === 'string')
        .map((d) => normaliseDomain(d))
        .filter((d) => d && isValidHostname(d)),
    ),
  );
  if (!baseDomains.includes(primaryDomain)) {
    baseDomains.unshift(primaryDomain);
  }
  const fallbackDomain =
    typeof raw.fallbackDomain === 'string'
      ? normaliseDomain(raw.fallbackDomain)
      : undefined;
  const validFallback =
    fallbackDomain && isValidHostname(fallbackDomain)
      ? fallbackDomain
      : undefined;
  const allowExternalFallback = raw.allowExternalFallback === true;
  if (
    validFallback &&
    allowExternalFallback &&
    !baseDomains.includes(validFallback)
  ) {
    baseDomains.push(validFallback);
  }

  const rawCname =
    typeof raw.customDomainCname === 'string'
      ? normaliseHost(raw.customDomainCname)
      : '';
  const customDomainCname =
    rawCname && isValidHostname(rawCname)
      ? rawCname
      : `cname.${primaryDomain}`;

  const rawHosts =
    raw.platformHosts && typeof raw.platformHosts === 'object'
      ? (raw.platformHosts as Record<string, unknown>)
      : {};
  const appDomain =
    typeof raw.appDomain === 'string'
      ? normaliseDomain(raw.appDomain)
      : undefined;
  const validAppDomain =
    appDomain && isValidHostname(appDomain) ? appDomain : undefined;
  const appBase = validAppDomain || primaryDomain;
  const host = (key: string, fallback: string): string => {
    const value =
      typeof rawHosts[key] === 'string' ? normaliseHost(rawHosts[key]) : '';
    return value && isValidHostname(value) ? value : fallback;
  };

  return {
    primaryDomain,
    baseDomains,
    fallbackDomain: validFallback,
    customDomainCname,
    allowExternalFallback,
    primaryHealthy: raw.primaryHealthy !== false,
    platformHosts: {
      landing: host('landing', `www.${primaryDomain}`),
      platformAdmin: host('platformAdmin', `saas.${appBase}`),
      platformApi: host('platformApi', `api.${appBase}`),
      webhooks: host('webhooks', `api.${appBase}`),
    },
  };
}

export function readTenantDomainConfig(
  env: NodeJS.ProcessEnv = process.env,
): TenantDomainConfig {
  const primaryDomain =
    normaliseDomain(env.SAAS_PRIMARY_DOMAIN ?? '') || 'ecomate.bd';
  const configuredBases = (env.SAAS_BASE_DOMAINS ?? primaryDomain)
    .split(',')
    .map((domain) => normaliseDomain(domain))
    .filter(Boolean);
  const fallbackDomain =
    normaliseDomain(env.SAAS_FALLBACK_DOMAIN ?? '') || undefined;
  const allowExternalFallback = env.SAAS_ALLOW_EXTERNAL_FALLBACK === 'true';
  const baseDomains =
    configuredBases.length > 0 ? configuredBases : [primaryDomain];
  // An explicitly allowed external fallback is also a valid alias base.
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
    platformHosts: {
      landing: `www.${primaryDomain}`,
      platformAdmin: `saas.${primaryDomain}`,
      platformApi: `api.${primaryDomain}`,
      webhooks: `api.${primaryDomain}`,
    },
  };
}

export type TenantHostResolution =
  | { kind: 'platform'; role: keyof TenantDomainConfig['platformHosts']; host: string }
  | {
      kind: 'tenant';
      slug: string;
      baseDomain: string;
      canonicalHost: string;
      isAlias: boolean;
    }
  | { kind: 'custom'; host: string }
  | { kind: 'unknown'; host: string };

export function resolveTenantHost(
  rawHost: string,
  config: TenantDomainConfig = readTenantDomainConfig(),
): TenantHostResolution {
  const host = normaliseHost(rawHost);
  if (!host) return { kind: 'unknown', host };

  const platformRoles = Object.entries(config.platformHosts) as Array<
    [keyof TenantDomainConfig['platformHosts'], string]
  >;
  for (const [role, platformHost] of platformRoles) {
    if (host === platformHost) return { kind: 'platform', role, host };
  }

  // A host that matched a base suffix but yielded no valid tenant slug is
  // UNKNOWN — it must not fall through to 'custom', or a dotted host
  // under our own base (foo.bar.ecomate.bd) could be attached as a
  // "custom" domain. Track the match separately from the slug validity.
  let matchedBase = false;
  for (const baseDomain of config.baseDomains) {
    if (host === baseDomain) {
      return { kind: 'platform', role: 'landing', host };
    }
    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) continue;
    matchedBase = true;

    const slug = host.slice(0, -suffix.length);
    // A dotted slug means this base matched only as a SUFFIX of a longer
    // base (e.g. `shop.ecomate.bd` ends with `.ecomate.bd`, leaving the
    // dotted slug `acme.shop`) — try the next, more-specific base instead
    // of giving up. A reserved slug is reserved on every base, so it
    // still resolves as unknown immediately.
    if (!slug || slug.includes('.')) continue;
    if (RESERVED_TENANT_SLUGS.has(slug)) {
      return { kind: 'unknown', host };
    }

    return {
      kind: 'tenant',
      slug,
      baseDomain,
      canonicalHost: `${slug}.${config.primaryDomain}`,
      isAlias: baseDomain !== config.primaryDomain,
    };
  }
  if (matchedBase) return { kind: 'unknown', host };

  if (host === config.customDomainCname) {
    return { kind: 'platform', role: 'platformApi', host };
  }

  return { kind: 'custom', host };
}

export function canonicalTenantHost(
  slug: string,
  config: TenantDomainConfig = readTenantDomainConfig(),
  customHost?: string | null,
): string {
  return customHost
    ? normaliseHost(customHost)
    : `${slug}.${config.primaryDomain}`;
}
