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
  const baseDomains =
    configuredBases.length > 0 ? configuredBases : [primaryDomain];
  const fallbackDomain =
    normaliseDomain(env.SAAS_FALLBACK_DOMAIN ?? '') || undefined;

  return {
    primaryDomain,
    baseDomains,
    fallbackDomain,
    customDomainCname:
      normaliseHost(env.SAAS_CUSTOM_DOMAIN_CNAME ?? '') ||
      `cname.${primaryDomain}`,
    allowExternalFallback: env.SAAS_ALLOW_EXTERNAL_FALLBACK === 'true',
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

  for (const baseDomain of config.baseDomains) {
    if (host === baseDomain) {
      return { kind: 'platform', role: 'landing', host };
    }
    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) continue;

    const slug = host.slice(0, -suffix.length);
    if (!slug || slug.includes('.') || RESERVED_TENANT_SLUGS.has(slug)) {
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
