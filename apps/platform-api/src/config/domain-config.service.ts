import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';

export interface PlatformHosts {
  landing: string;
  platformAdmin: string;
  platformApi: string;
  webhooks: string;
}

export interface DomainConfig {
  /** Tenant base domain: tenants live at `{slug}.{primaryDomain}`. */
  primaryDomain: string;
  /** Tenant base domains (primary first) incl. alias bases. */
  baseDomains: string[];
  /**
   * Parent domain of the console/API hosts (`saas.`/`api.`). Unset =
   * legacy single-domain mode: platform hosts derive from primaryDomain.
   * When set it must be fully separate from the tenant domain (see
   * validate()) — that separation is the point: a tenant subdomain must
   * never share a parent domain with the app.
   */
  appDomain?: string;
  /**
   * Full landing origin (verification emails, redirects). normalise()
   * always fills the derived `https://{platformHosts.landing}` when no
   * override is stored, so getConfig() always carries a concrete value.
   */
  landingUrl: string;
  /** Full console origin (invite links). Same derive-when-unset rule. */
  adminUrl: string;
  fallbackDomain?: string;
  customDomainCname: string;
  allowExternalFallback: boolean;
  /**
   * Whether the primary domain is currently usable. Set to false during a
   * primary-domain/TLS outage: absolute URLs (emails, invoices, redirects)
   * then use the fallback domain, while canonical URLs stay canonical.
   */
  primaryHealthy: boolean;
  platformHosts: PlatformHosts;
}

export type DomainConfigUpdate = Omit<
  Partial<DomainConfig>,
  'platformHosts'
> & {
  platformHosts?: Partial<PlatformHosts>;
};

export type HostResolution =
  | { kind: 'platform'; role: keyof PlatformHosts; host: string }
  | {
      kind: 'tenant';
      slug: string;
      baseDomain: string;
      canonicalHost: string;
      isAlias: boolean;
    }
  | { kind: 'custom'; host: string }
  | { kind: 'unknown'; host: string };

export const RESERVED_SLUGS = new Set([
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

// Hostname shape: at least one dot, labels of alphanumerics/hyphens that
// neither start nor end with a hyphen. Keep in sync with
// UpdateDomainConfigDto and apps/backend/src/tenancy/tenant-host.ts.
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function isValidHostname(host: string): boolean {
  return host.length > 0 && host.length <= 253 && HOSTNAME_RE.test(host);
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSubdomainOf(host: string, parent: string): boolean {
  return host !== parent && host.endsWith(`.${parent}`);
}

function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function normaliseDomain(domain: string): string {
  return normaliseHost(domain).replace(/^www\./, '');
}

function normaliseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Platform hosts derived from the tenant + app domains. The landing host
 * ALWAYS derives from the tenant base (primaryDomain) — the landing stays
 * on the tenant-side domain (ecomate.bd) even after the app moves; the
 * console/API hosts derive from the app domain when one is set, else
 * from the primary (legacy single-domain mode).
 */
function derivePlatformHosts(
  primaryDomain: string,
  appDomain?: string,
): PlatformHosts {
  const appBase = appDomain || primaryDomain;
  return {
    landing: `www.${primaryDomain}`,
    platformAdmin: `saas.${appBase}`,
    platformApi: `api.${appBase}`,
    webhooks: `api.${appBase}`,
  };
}

@Injectable()
export class DomainConfigService implements OnModuleInit {
  private readonly logger = new Logger(DomainConfigService.name);
  private config!: DomainConfig;
  /**
   * Phase 8 Stage 2 item 25 (D12): live primary-domain probe state, set by
   * TlsHealthService. null = no probe result yet. This is runtime state
   * only — never persisted to PlatformSetting.domains (a stale persisted
   * "unhealthy" would survive restarts and pin the platform to fallback).
   */
  private probeHealthy: boolean | null = null;

  constructor(private readonly prisma: PlatformPrismaService) {}

  async onModuleInit() {
    this.config = await this.load();
    this.validate(this.config);
    this.logger.log(
      `Domains: primary=${this.config.primaryDomain} app=${this.config.appDomain ?? '(same as primary)'} base=[${this.config.baseDomains.join(
        ',',
      )}] fallback=${this.config.fallbackDomain ?? '(none)'}`,
    );
  }

  getConfig(): DomainConfig {
    return this.config;
  }

  /** Effective landing origin (stored override, else derived from the landing host). */
  landingUrl(): string {
    return this.config.landingUrl;
  }

  /** Effective console origin (stored override, else derived from the console host). */
  adminUrl(): string {
    return this.config.adminUrl;
  }

  /**
   * Runtime-editable domain configuration. Persists PlatformSetting.domains
   * and swaps the in-memory config immediately; env remains the bootstrap.
   *
   * Derivation rules (a value the caller does NOT pass explicitly follows
   * the domain it derives from):
   * - platform hosts: an explicit host wins per-role. Otherwise, an
   *   appDomain change re-derives console/API/webhooks from it (landing
   *   untouched); a primary change re-derives ALL hosts only in legacy
   *   mode (no appDomain); with an appDomain set a primary change moves
   *   no host (the landing host is operator-managed then — it has DNS +
   *   Caddy behind it, so it must never move silently).
   * - customDomainCname follows the TENANT domain: a primary change (or
   *   an explicit clear) re-derives it to `cname.{newPrimary}`.
   * - landingUrl/adminUrl follow their host: a host change re-derives the
   *   URL unless the caller passed an explicit URL in the same update.
   *
   * No-op filter: the console form sends every field on every save, so a
   * passed value EQUAL to what the server currently derives is treated as
   * "not passed" (a form echo, not an intentional override) — otherwise a
   * primary/appDomain change could never re-derive anything from the UI.
   * A passed value that DIFFERS from the derived one is an explicit
   * override and is kept. '' clears a field back to its derived value.
   */
  async update(input: DomainConfigUpdate): Promise<DomainConfig> {
    const current = this.config;
    const primaryDomain = normaliseDomain(
      input.primaryDomain || current.primaryDomain,
    );
    const requestedBase =
      input.baseDomains && input.baseDomains.length > 0
        ? input.baseDomains
        : current.baseDomains;
    const baseDomains = Array.from(
      new Set([
        primaryDomain,
        ...requestedBase
          .map((domain) => normaliseDomain(domain))
          .filter((domain) => domain && domain !== primaryDomain),
      ]),
    );
    const appDomain =
      input.appDomain === undefined
        ? current.appDomain
        : normaliseDomain(input.appDomain) || undefined;
    const primaryChanged = primaryDomain !== current.primaryDomain;
    const appDomainChanged = appDomain !== current.appDomain;

    const derivedHostsNow = derivePlatformHosts(
      current.primaryDomain,
      current.appDomain,
    );
    const derivedHostsNext = derivePlatformHosts(primaryDomain, appDomain);
    // Explicit per-role hosts: '' clears the role back to derived; a value
    // equal to the currently-derived host is a form echo (dropped).
    const hostsInput: Partial<PlatformHosts> = {};
    for (const [role, value] of Object.entries(input.platformHosts ?? {})) {
      const key = role as keyof PlatformHosts;
      if (!(key in derivedHostsNow)) continue;
      const host = normaliseHost(value ?? '');
      if (!host) {
        hostsInput[key] = derivedHostsNext[key];
      } else if (host !== derivedHostsNow[key]) {
        hostsInput[key] = host;
      }
    }
    let baseHosts: PlatformHosts;
    if (appDomainChanged) {
      baseHosts = appDomain
        ? {
            ...current.platformHosts,
            platformAdmin: derivedHostsNext.platformAdmin,
            platformApi: derivedHostsNext.platformApi,
            webhooks: derivedHostsNext.webhooks,
          }
        : derivedHostsNext;
    } else if (primaryChanged && !appDomain) {
      baseHosts = derivedHostsNext;
    } else {
      baseHosts = { ...current.platformHosts };
    }
    const platformHosts: PlatformHosts = { ...baseHosts, ...hostsInput };

    const derivedCnameNow = `cname.${current.primaryDomain}`;
    let customDomainCname: string;
    if (input.customDomainCname === undefined) {
      customDomainCname = primaryChanged
        ? `cname.${primaryDomain}`
        : current.customDomainCname;
    } else {
      const cname = normaliseHost(input.customDomainCname);
      if (!cname || cname === derivedCnameNow) {
        customDomainCname = primaryChanged
          ? `cname.${primaryDomain}`
          : cname
            ? current.customDomainCname
            : `cname.${primaryDomain}`;
      } else {
        customDomainCname = cname;
      }
    }

    const landingUrl = this.resolveUrlInput(
      input.landingUrl,
      current.landingUrl,
      current.platformHosts.landing,
      platformHosts.landing,
    );
    const adminUrl = this.resolveUrlInput(
      input.adminUrl,
      current.adminUrl,
      current.platformHosts.platformAdmin,
      platformHosts.platformAdmin,
    );

    const merged: DomainConfig = {
      primaryDomain,
      baseDomains,
      appDomain,
      landingUrl,
      adminUrl,
      fallbackDomain:
        input.fallbackDomain === undefined
          ? current.fallbackDomain
          : normaliseDomain(input.fallbackDomain) || undefined,
      customDomainCname,
      allowExternalFallback:
        input.allowExternalFallback ?? current.allowExternalFallback,
      primaryHealthy: input.primaryHealthy ?? current.primaryHealthy,
      platformHosts,
    };

    try {
      // Strict validation on the merged RAW config: invalid input 400s
      // here. normalise() below only formats (it also sanitises legacy
      // rows on the load path, where validate() runs after it instead).
      this.validate(merged);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const next = this.normalise(merged);
    // Safety net: normalise must never produce an invalid config.
    this.validate(next);

    await this.prisma.platformSetting.upsert({
      where: { key: 'domains' },
      update: { value: next as any },
      create: { key: 'domains', value: next as any },
    });
    this.config = next;
    this.logger.log(
      `Domains updated: primary=${next.primaryDomain} app=${next.appDomain ?? '(same as primary)'} base=[${next.baseDomains.join(
        ',',
      )}] fallback=${next.fallbackDomain ?? '(none)'}`,
    );
    return next;
  }

  /**
   * Resolve a landing/console URL input against a (possibly changed) host.
   * Absent → follow the host (re-derive on host change, else keep).
   * '' → clear the override, derive from the (possibly new) host. A value
   * equal to the currently-derived URL is a form echo → follow the host.
   * Anything else is an explicit override (validate() checks its shape).
   */
  private resolveUrlInput(
    inputValue: string | undefined,
    currentValue: string,
    currentHost: string,
    nextHost: string,
  ): string {
    const derivedNow = `https://${currentHost}`;
    if (inputValue === undefined) {
      return nextHost !== currentHost ? `https://${nextHost}` : currentValue;
    }
    const explicit = normaliseUrl(inputValue);
    if (!explicit) return `https://${nextHost}`;
    if (explicit === derivedNow) {
      return nextHost !== currentHost ? `https://${nextHost}` : explicit;
    }
    return explicit;
  }

  private async load(): Promise<DomainConfig> {
    const envConfig = this.fromEnv();
    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { key: 'domains' },
      });
      if (row?.value && typeof row.value === 'object') {
        const stored = row.value as Partial<DomainConfig>;
        // A stored row predating landingUrl/adminUrl must not inherit the
        // ENV-derived URLs: those were derived from the env primary, not
        // the stored one. Omit them here so normalise() re-derives from
        // the merged hosts. A stored override is kept as-is.
        const {
          landingUrl: _envLandingUrl,
          adminUrl: _envAdminUrl,
          ...envRest
        } = envConfig;
        const merged: DomainConfig = {
          ...envRest,
          ...stored,
          landingUrl: stored.landingUrl ?? '',
          adminUrl: stored.adminUrl ?? '',
          platformHosts: {
            ...envConfig.platformHosts,
            ...(stored.platformHosts ?? {}),
          },
        };
        return this.normalise(merged);
      }
    } catch (err) {
      this.logger.warn(
        `PlatformSetting.domains unavailable; using env bootstrap: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return this.normalise(envConfig);
  }

  private fromEnv(): DomainConfig {
    const primaryDomain =
      normaliseDomain(process.env.SAAS_PRIMARY_DOMAIN ?? '') || 'ecomate.bd';
    const baseDomains = (
      process.env.SAAS_BASE_DOMAINS ?? primaryDomain
    )
      .split(',')
      .map((d) => normaliseDomain(d))
      .filter(Boolean);
    const fallbackDomain =
      normaliseDomain(process.env.SAAS_FALLBACK_DOMAIN ?? '') || undefined;
    const customDomainCname =
      normaliseHost(process.env.SAAS_CUSTOM_DOMAIN_CNAME ?? '') ||
      `cname.${primaryDomain}`;
    const allowExternalFallback =
      process.env.SAAS_ALLOW_EXTERNAL_FALLBACK === 'true';

    // Env bootstrap only: an invalid value is ignored (with a warning),
    // never fatal — a typo'd env var must not brick the boot. The UI path
    // (update → validate) is strict instead.
    const rawAppDomain = normaliseDomain(process.env.SAAS_APP_DOMAIN ?? '');
    const appDomain =
      rawAppDomain && isValidHostname(rawAppDomain) ? rawAppDomain : undefined;
    if (rawAppDomain && !appDomain) {
      this.logger.warn(`Ignoring invalid SAAS_APP_DOMAIN: ${rawAppDomain}`);
    }

    const derivedHosts = derivePlatformHosts(primaryDomain, appDomain);
    const envHost = (name: string, fallback: string): string => {
      const raw = normaliseHost(process.env[name] ?? '');
      if (!raw) return fallback;
      if (!isValidHostname(raw)) {
        this.logger.warn(`Ignoring invalid ${name}: ${raw}`);
        return fallback;
      }
      return raw;
    };
    const platformApi = envHost('PLATFORM_API_HOST', derivedHosts.platformApi);
    const platformHosts: PlatformHosts = {
      landing: envHost('PLATFORM_LANDING_HOST', derivedHosts.landing),
      platformAdmin: envHost(
        'PLATFORM_ADMIN_HOST',
        derivedHosts.platformAdmin,
      ),
      platformApi,
      // No env var of its own: webhooks always follow the API host.
      webhooks: platformApi,
    };

    const envUrl = (name: string, fallback: string): string => {
      const raw = normaliseUrl(process.env[name] ?? '');
      if (!raw) return fallback;
      if (!isValidHttpUrl(raw)) {
        this.logger.warn(`Ignoring invalid ${name}: ${raw}`);
        return fallback;
      }
      return raw;
    };

    return {
      primaryDomain,
      baseDomains: baseDomains.length > 0 ? baseDomains : [primaryDomain],
      appDomain,
      landingUrl: envUrl(
        'PLATFORM_LANDING_URL',
        `https://${platformHosts.landing}`,
      ),
      adminUrl: envUrl(
        'PLATFORM_ADMIN_URL',
        `https://${platformHosts.platformAdmin}`,
      ),
      fallbackDomain,
      customDomainCname,
      allowExternalFallback,
      primaryHealthy: process.env.SAAS_PRIMARY_UNHEALTHY !== 'true',
      platformHosts,
    };
  }

  private normalise(config: DomainConfig): DomainConfig {
    const primaryDomain = normaliseDomain(config.primaryDomain);
    const baseDomains = Array.from(
      new Set(
        (config.baseDomains ?? [])
          .map((d) => normaliseDomain(d))
          .filter((d) => d && isValidHostname(d)),
      ),
    );
    if (primaryDomain && !baseDomains.includes(primaryDomain)) {
      baseDomains.unshift(primaryDomain);
    }
    const rawFallback = config.fallbackDomain
      ? normaliseDomain(config.fallbackDomain)
      : undefined;
    const fallbackDomain =
      rawFallback && isValidHostname(rawFallback) ? rawFallback : undefined;
    // A fallback domain is a valid alias base for every tenant. When it is
    // external (allowExternalFallback), keep it in the base-domain loop so
    // {slug}.<fallback> resolves to the same tenant.
    if (
      fallbackDomain &&
      !baseDomains.includes(fallbackDomain) &&
      config.allowExternalFallback
    ) {
      baseDomains.push(fallbackDomain);
    }
    const rawAppDomain = config.appDomain
      ? normaliseDomain(config.appDomain)
      : undefined;
    const appDomain =
      rawAppDomain && isValidHostname(rawAppDomain) ? rawAppDomain : undefined;
    const derivedHosts = derivePlatformHosts(
      primaryDomain || 'ecomate.bd',
      appDomain,
    );
    const storedHosts = config.platformHosts ?? ({} as Partial<PlatformHosts>);
    const validHost = (
      value: string | undefined,
      fallback: string,
    ): string => {
      const host = value ? normaliseHost(value) : '';
      return host && isValidHostname(host) ? host : fallback;
    };
    const platformApi = validHost(storedHosts.platformApi, derivedHosts.platformApi);
    const platformHosts: PlatformHosts = {
      landing: validHost(storedHosts.landing, derivedHosts.landing),
      platformAdmin: validHost(
        storedHosts.platformAdmin,
        derivedHosts.platformAdmin,
      ),
      platformApi,
      webhooks: validHost(storedHosts.webhooks, platformApi),
    };
    const rawCname = normaliseHost(config.customDomainCname ?? '');
    const customDomainCname =
      rawCname && isValidHostname(rawCname)
        ? rawCname
        : `cname.${primaryDomain || 'ecomate.bd'}`;
    const landingUrl =
      config.landingUrl && isValidHttpUrl(config.landingUrl)
        ? normaliseUrl(config.landingUrl)
        : `https://${platformHosts.landing}`;
    const adminUrl =
      config.adminUrl && isValidHttpUrl(config.adminUrl)
        ? normaliseUrl(config.adminUrl)
        : `https://${platformHosts.platformAdmin}`;
    return {
      ...config,
      primaryDomain,
      baseDomains,
      appDomain,
      landingUrl,
      adminUrl,
      fallbackDomain,
      customDomainCname,
      primaryHealthy: config.primaryHealthy !== false,
      platformHosts,
    };
  }

  private validate(config: DomainConfig): void {
    const primaryDomain = normaliseDomain(config.primaryDomain ?? '');
    if (!primaryDomain) {
      throw new Error('Domain config: primaryDomain is required');
    }
    if (!isValidHostname(primaryDomain)) {
      throw new Error(
        `Domain config: primaryDomain "${primaryDomain}" is not a valid hostname`,
      );
    }
    const baseDomains = (config.baseDomains ?? [])
      .map((d) => normaliseDomain(d))
      .filter(Boolean);
    if (baseDomains.length === 0) {
      throw new Error('Domain config: at least one base domain is required');
    }
    for (const base of baseDomains) {
      if (!isValidHostname(base)) {
        throw new Error(
          `Domain config: base domain "${base}" is not a valid hostname`,
        );
      }
    }
    if (baseDomains[0] !== primaryDomain) {
      throw new Error(
        'Domain config: primaryDomain must be the first entry of baseDomains',
      );
    }
    if (new Set(baseDomains).size !== baseDomains.length) {
      throw new Error('Domain config: baseDomains must be unique');
    }
    const fallbackDomain = config.fallbackDomain
      ? normaliseDomain(config.fallbackDomain)
      : undefined;
    if (fallbackDomain) {
      if (!isValidHostname(fallbackDomain)) {
        throw new Error(
          `Domain config: fallbackDomain "${fallbackDomain}" is not a valid hostname`,
        );
      }
      if (
        !baseDomains.includes(fallbackDomain) &&
        !config.allowExternalFallback
      ) {
        throw new Error(
          'Domain config: fallbackDomain must be in baseDomains or allowExternalFallback must be true',
        );
      }
    }
    const customDomainCname = normaliseHost(config.customDomainCname ?? '');
    if (customDomainCname && !isValidHostname(customDomainCname)) {
      throw new Error(
        'Domain config: customDomainCname must be a hostname',
      );
    }
    // App/tenant separation: the app domain must be fully unrelated to the
    // tenant domain. Equal, a base-domain member, a subdomain, or a parent
    // would all let one parent domain (or one PSL gap) bridge app and
    // tenant. Unset (legacy single-domain mode) is always valid — that is
    // what keeps the current deployment working until the split is made.
    const appDomain = config.appDomain
      ? normaliseDomain(config.appDomain)
      : undefined;
    if (appDomain) {
      if (!isValidHostname(appDomain)) {
        throw new Error(
          `Domain config: appDomain "${appDomain}" is not a valid hostname`,
        );
      }
      if (appDomain === primaryDomain) {
        throw new Error(
          'Domain config: the app domain must differ from the tenant domain (primaryDomain)',
        );
      }
      if (baseDomains.includes(appDomain)) {
        throw new Error(
          'Domain config: the app domain must not be one of the tenant base domains',
        );
      }
      if (
        isSubdomainOf(appDomain, primaryDomain) ||
        isSubdomainOf(primaryDomain, appDomain)
      ) {
        throw new Error(
          'Domain config: the app domain must not be a subdomain or a parent of the tenant domain',
        );
      }
    }
    for (const [role, host] of Object.entries(
      config.platformHosts ?? {},
    )) {
      const normalised = normaliseHost(host ?? '');
      if (normalised && !isValidHostname(normalised)) {
        throw new Error(
          `Domain config: ${role} host "${normalised}" is not a valid hostname`,
        );
      }
    }
    if (config.landingUrl && !isValidHttpUrl(config.landingUrl)) {
      throw new Error(
        'Domain config: landingUrl must be a valid http(s) URL',
      );
    }
    if (config.adminUrl && !isValidHttpUrl(config.adminUrl)) {
      throw new Error(
        'Domain config: adminUrl must be a valid http(s) URL',
      );
    }
  }

  /**
   * Resolve a request host into a platform host, a tenant subdomain, a custom
   * domain, or unknown. Custom-domain ownership and tenant lookup are handled
   * by the tenant registry; this service only parses the host.
   */
  resolveHost(rawHost: string): HostResolution {
    const host = normaliseHost(rawHost);
    const platformRoles = Object.entries(this.config.platformHosts) as Array<
      [keyof PlatformHosts, string]
    >;
    for (const [role, platformHost] of platformRoles) {
      if (host === platformHost) return { kind: 'platform', role, host };
    }

    for (const baseDomain of this.config.baseDomains) {
      if (host === baseDomain) {
        return { kind: 'platform', role: 'landing', host };
      }
      const suffix = `.${baseDomain}`;
      if (host.endsWith(suffix)) {
        const slug = host.slice(0, -suffix.length);
        if (!slug || slug.includes('.') || RESERVED_SLUGS.has(slug)) {
          return { kind: 'unknown', host };
        }
        return {
          kind: 'tenant',
          slug,
          baseDomain,
          canonicalHost: `${slug}.${this.config.primaryDomain}`,
          isAlias: baseDomain !== this.config.primaryDomain,
        };
      }
    }

    if (host === this.config.customDomainCname) {
      return { kind: 'platform', role: 'platformApi', host };
    }
    return { kind: 'custom', host };
  }

  canonicalHost(slug: string, customHost?: string | null): string {
    return customHost
      ? normaliseHost(customHost)
      : `${slug}.${this.config.primaryDomain}`;
  }

  /**
   * Live probe result for the primary domain (null = no probe has run
   * yet). Set by TlsHealthService; read by the health endpoint and the
   * TLS status endpoint.
   */
  getPrimaryProbeResult(): boolean | null {
    return this.probeHealthy;
  }

  /** Record a primary-domain probe outcome (TLS health job only). */
  setPrimaryProbeResult(healthy: boolean): void {
    this.probeHealthy = healthy;
  }

  /**
   * Whether the primary domain is currently usable. Precedence:
   *   1. SAAS_PRIMARY_UNHEALTHY=true (manual operator override) → false.
   *   2. A live probe reporting unhealthy → false.
   *   3. Otherwise the configured value (env bootstrap / stored setting).
   * The manual flag therefore still forces fallback even when the probe
   * says healthy — it is the operator's kill switch, not dead config.
   */
  isPrimaryHealthy(): boolean {
    if (process.env.SAAS_PRIMARY_UNHEALTHY === 'true') return false;
    if (this.probeHealthy === false) return false;
    return this.config.primaryHealthy !== false;
  }

  /**
   * Base domain for NEW absolute URLs (emails, invoices, password resets):
   * primary while healthy, fallback during a primary-domain/TLS outage.
   */
  effectiveBaseDomain(): string {
    if (!this.isPrimaryHealthy() && this.config.fallbackDomain) {
      return this.config.fallbackDomain;
    }
    return this.config.primaryDomain;
  }

  /** Host for new tenant links: verified custom domain wins, then fallback-aware base. */
  tenantHost(slug: string, customHost?: string | null): string {
    if (customHost) return normaliseHost(customHost);
    return `${slug}.${this.effectiveBaseDomain()}`;
  }

  absoluteUrl(slug: string, path = '/', customHost?: string | null): string {
    const host = this.tenantHost(slug, customHost);
    return `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
  }
}
