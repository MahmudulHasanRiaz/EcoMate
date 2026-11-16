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
  primaryDomain: string;
  baseDomains: string[];
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

@Injectable()
export class DomainConfigService implements OnModuleInit {
  private readonly logger = new Logger(DomainConfigService.name);
  private config!: DomainConfig;

  constructor(private readonly prisma: PlatformPrismaService) {}

  async onModuleInit() {
    this.config = await this.load();
    this.validate(this.config);
    this.logger.log(
      `Domains: primary=${this.config.primaryDomain} base=[${this.config.baseDomains.join(
        ',',
      )}] fallback=${this.config.fallbackDomain ?? '(none)'}`,
    );
  }

  getConfig(): DomainConfig {
    return this.config;
  }

  /**
   * Runtime-editable domain configuration. Persists PlatformSetting.domains
   * and swaps the in-memory config immediately; env remains the bootstrap.
   */
  async update(input: DomainConfigUpdate): Promise<DomainConfig> {
    const primaryDomain = normaliseDomain(
      input.primaryDomain || this.config.primaryDomain,
    );
    const requestedBase =
      input.baseDomains && input.baseDomains.length > 0
        ? input.baseDomains
        : this.config.baseDomains;
    const baseDomains = [
      primaryDomain,
      ...requestedBase
        .map((domain) => normaliseDomain(domain))
        .filter((domain) => domain && domain !== primaryDomain),
    ];

    const primaryChanged =
      primaryDomain !== this.config.primaryDomain && !input.platformHosts;
    const next = this.normalise({
      ...this.config,
      ...input,
      primaryDomain,
      baseDomains,
      platformHosts: {
        ...(primaryChanged
          ? {
              landing: `www.${primaryDomain}`,
              platformAdmin: `saas.${primaryDomain}`,
              platformApi: `api.${primaryDomain}`,
              webhooks: `api.${primaryDomain}`,
            }
          : this.config.platformHosts),
        ...(input.platformHosts ?? {}),
      },
    });

    try {
      this.validate(next);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }

    await this.prisma.platformSetting.upsert({
      where: { key: 'domains' },
      update: { value: next as any },
      create: { key: 'domains', value: next as any },
    });
    this.config = next;
    this.logger.log(
      `Domains updated: primary=${next.primaryDomain} base=[${next.baseDomains.join(
        ',',
      )}] fallback=${next.fallbackDomain ?? '(none)'}`,
    );
    return next;
  }

  private async load(): Promise<DomainConfig> {
    const envConfig = this.fromEnv();
    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { key: 'domains' },
      });
      if (row?.value && typeof row.value === 'object') {
        const stored = row.value as Partial<DomainConfig>;
        return this.normalise({
          ...envConfig,
          ...stored,
          platformHosts: {
            ...envConfig.platformHosts,
            ...(stored.platformHosts ?? {}),
          },
        });
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

    return {
      primaryDomain,
      baseDomains: baseDomains.length > 0 ? baseDomains : [primaryDomain],
      fallbackDomain,
      customDomainCname,
      allowExternalFallback,
      primaryHealthy: process.env.SAAS_PRIMARY_UNHEALTHY !== 'true',
      platformHosts: {
        landing: `www.${primaryDomain}`,
        platformAdmin: `saas.${primaryDomain}`,
        platformApi: `api.${primaryDomain}`,
        webhooks: `api.${primaryDomain}`,
      },
    };
  }

  private normalise(config: DomainConfig): DomainConfig {
    const primaryDomain = normaliseDomain(config.primaryDomain);
    const baseDomains = Array.from(
      new Set(
        (config.baseDomains ?? [])
          .map((d) => normaliseDomain(d))
          .filter(Boolean),
      ),
    );
    const fallbackDomain = config.fallbackDomain
      ? normaliseDomain(config.fallbackDomain)
      : undefined;
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
    return {
      ...config,
      primaryDomain,
      baseDomains,
      fallbackDomain,
      primaryHealthy: config.primaryHealthy !== false,
      customDomainCname: normaliseHost(config.customDomainCname),
      platformHosts: {
        landing: normaliseHost(config.platformHosts.landing),
        platformAdmin: normaliseHost(config.platformHosts.platformAdmin),
        platformApi: normaliseHost(config.platformHosts.platformApi),
        webhooks: normaliseHost(config.platformHosts.webhooks),
      },
    };
  }

  private validate(config: DomainConfig): void {
    if (!config.primaryDomain) {
      throw new Error('Domain config: primaryDomain is required');
    }
    if (config.baseDomains.length === 0) {
      throw new Error('Domain config: at least one base domain is required');
    }
    if (config.baseDomains[0] !== config.primaryDomain) {
      throw new Error(
        'Domain config: primaryDomain must be the first entry of baseDomains',
      );
    }
    if (new Set(config.baseDomains).size !== config.baseDomains.length) {
      throw new Error('Domain config: baseDomains must be unique');
    }
    if (
      config.fallbackDomain &&
      !config.baseDomains.includes(config.fallbackDomain) &&
      !config.allowExternalFallback
    ) {
      throw new Error(
        'Domain config: fallbackDomain must be in baseDomains or allowExternalFallback must be true',
      );
    }
    if (!config.customDomainCname.includes('.')) {
      throw new Error('Domain config: customDomainCname must be a hostname');
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

  isPrimaryHealthy(): boolean {
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
