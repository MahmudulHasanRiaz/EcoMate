export interface TenantDomainConfig {
  primaryDomain: string;
  baseDomains: string[];
  fallbackDomain?: string;
  customDomainCname: string;
  allowExternalFallback: boolean;
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
