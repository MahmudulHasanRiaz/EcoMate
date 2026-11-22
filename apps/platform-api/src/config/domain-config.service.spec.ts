import { DomainConfigService } from './domain-config.service';

function buildService(stored: unknown = null) {
  const prisma = {
    platformSetting: {
      findUnique: jest.fn().mockResolvedValue(
        stored === null ? null : { key: 'domains', value: stored },
      ),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
  return new DomainConfigService(prisma);
}

const ORIGINAL_ENV = { ...process.env };

describe('DomainConfigService', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SAAS_PRIMARY_DOMAIN;
    delete process.env.SAAS_BASE_DOMAINS;
    delete process.env.SAAS_FALLBACK_DOMAIN;
    delete process.env.SAAS_CUSTOM_DOMAIN_CNAME;
    delete process.env.SAAS_ALLOW_EXTERNAL_FALLBACK;
    delete process.env.SAAS_PRIMARY_UNHEALTHY;
    delete process.env.SAAS_APP_DOMAIN;
    delete process.env.PLATFORM_LANDING_HOST;
    delete process.env.PLATFORM_ADMIN_HOST;
    delete process.env.PLATFORM_API_HOST;
    delete process.env.PLATFORM_LANDING_URL;
    delete process.env.PLATFORM_ADMIN_URL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('bootstraps from env with ecomate.bd defaults', async () => {
    const service = buildService();
    await service.onModuleInit();

    expect(service.getConfig()).toMatchObject({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd'],
      appDomain: undefined,
      customDomainCname: 'cname.ecomate.bd',
      landingUrl: 'https://www.ecomate.bd',
      adminUrl: 'https://saas.ecomate.bd',
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
      },
    });
    expect(service.landingUrl()).toBe('https://www.ecomate.bd');
    expect(service.adminUrl()).toBe('https://saas.ecomate.bd');
  });

  it('accepts additional base domains and a fallback in the list', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd, alias.example';
    process.env.SAAS_FALLBACK_DOMAIN = 'alias.example';

    const service = buildService();
    await service.onModuleInit();

    expect(service.getConfig().baseDomains).toEqual([
      'ecomate.bd',
      'alias.example',
    ]);
    expect(service.getConfig().fallbackDomain).toBe('alias.example');
  });

  it('rejects a primary domain that is not first in the base list', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'alias.example,ecomate.bd';

    const service = buildService();
    await expect(service.onModuleInit()).rejects.toThrow(
      'primaryDomain must be the first entry',
    );
  });

  it('rejects a fallback outside the base list unless explicitly allowed', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    process.env.SAAS_FALLBACK_DOMAIN = 'fallback.example';

    await expect(buildService().onModuleInit()).rejects.toThrow(
      'fallbackDomain must be in baseDomains',
    );
  });

  it('updates and persists runtime domain config', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    const prisma = {
      platformSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const service = new DomainConfigService(prisma);
    await service.onModuleInit();

    const next = await service.update({
      primaryDomain: 'new.example',
      baseDomains: ['old.example', 'new.example', 'new.example'],
      fallbackDomain: '',
      primaryHealthy: false,
    });

    expect(next.baseDomains).toEqual(['new.example', 'old.example']);
    expect(next.fallbackDomain).toBeUndefined();
    expect(next.primaryHealthy).toBe(false);
    expect(next.platformHosts).toMatchObject({
      landing: 'www.new.example',
      platformAdmin: 'saas.new.example',
    });
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'domains' },
      update: { value: next },
      create: { key: 'domains', value: next },
    });
    expect(service.getConfig()).toEqual(next);
  });

  it('refuses an invalid fallback update', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    const service = new DomainConfigService({
      platformSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any);
    await service.onModuleInit();

    await expect(
      service.update({
        fallbackDomain: 'outside.example',
        allowExternalFallback: false,
      }),
    ).rejects.toThrow('fallbackDomain must be in baseDomains');
  });

  it('prefers PlatformSetting.domains over env', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'env.example';
    process.env.SAAS_BASE_DOMAINS = 'env.example';

    const service = buildService({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd'],
      fallbackDomain: null,
      customDomainCname: 'cname.ecomate.bd',
      allowExternalFallback: false,
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
        webhooks: 'api.ecomate.bd',
      },
    });
    await service.onModuleInit();

    expect(service.getConfig().primaryDomain).toBe('ecomate.bd');
  });

  it('resolves tenant subdomains, aliases, platform hosts, and reserved slugs', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';

    const service = buildService();
    await service.onModuleInit();

    expect(service.resolveHost('acme.ecomate.bd')).toEqual({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
    expect(service.resolveHost('acme.alias.example')).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'alias.example',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
    expect(service.resolveHost('saas.ecomate.bd')).toMatchObject({
      kind: 'platform',
      role: 'platformAdmin',
    });
    expect(service.resolveHost('www.ecomate.bd')).toMatchObject({
      kind: 'platform',
      role: 'landing',
    });
    expect(service.resolveHost('admin.ecomate.bd')).toEqual({
      kind: 'unknown',
      host: 'admin.ecomate.bd',
    });
  });

  it('builds canonical and absolute URLs from a tenant slug', async () => {
    const service = buildService();
    await service.onModuleInit();

    expect(service.canonicalHost('acme')).toBe('acme.ecomate.bd');
    expect(service.canonicalHost('acme', 'shop.example')).toBe('shop.example');
    expect(service.absoluteUrl('acme', '/admin/')).toBe(
      'https://acme.ecomate.bd/admin/',
    );
  });

  it('uses the fallback base for new absolute URLs when the primary is unhealthy', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    process.env.SAAS_FALLBACK_DOMAIN = 'alias.example';
    process.env.SAAS_PRIMARY_UNHEALTHY = 'true';

    const service = buildService();
    await service.onModuleInit();

    expect(service.isPrimaryHealthy()).toBe(false);
    expect(service.effectiveBaseDomain()).toBe('alias.example');
    expect(service.absoluteUrl('acme', '/invoice/1')).toBe(
      'https://acme.alias.example/invoice/1',
    );
    // The canonical host does not move: only new links use the fallback.
    expect(service.canonicalHost('acme')).toBe('acme.ecomate.bd');
    // A verified custom domain still wins over the fallback.
    expect(service.absoluteUrl('acme', '/', 'shop.example.com')).toBe(
      'https://shop.example.com/',
    );
  });

  it('keeps the primary base when it is healthy', async () => {
    process.env.SAAS_FALLBACK_DOMAIN = 'alias.example';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';

    const service = buildService();
    await service.onModuleInit();

    expect(service.effectiveBaseDomain()).toBe('ecomate.bd');
    expect(service.absoluteUrl('acme', '/')).toBe('https://acme.ecomate.bd/');
  });

  it('treats an explicitly allowed external fallback as a tenant alias base', async () => {
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    process.env.SAAS_FALLBACK_DOMAIN = 'fallback.example';
    process.env.SAAS_ALLOW_EXTERNAL_FALLBACK = 'true';

    const service = buildService();
    await service.onModuleInit();

    expect(service.getConfig().baseDomains).toEqual([
      'ecomate.bd',
      'fallback.example',
    ]);
    expect(service.resolveHost('acme.fallback.example')).toMatchObject({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'fallback.example',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: true,
    });
  });

  describe('app/tenant domain split', () => {
    it('derives console/API hosts from SAAS_APP_DOMAIN, landing stays on the tenant domain', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'staging.ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'staging.ecomate.bd';
      process.env.SAAS_APP_DOMAIN = 'em.staging.commercians.com';

      const service = buildService();
      await service.onModuleInit();

      expect(service.getConfig()).toMatchObject({
        primaryDomain: 'staging.ecomate.bd',
        appDomain: 'em.staging.commercians.com',
        customDomainCname: 'cname.staging.ecomate.bd',
        landingUrl: 'https://www.staging.ecomate.bd',
        adminUrl: 'https://saas.em.staging.commercians.com',
        platformHosts: {
          landing: 'www.staging.ecomate.bd',
          platformAdmin: 'saas.em.staging.commercians.com',
          platformApi: 'api.em.staging.commercians.com',
          webhooks: 'api.em.staging.commercians.com',
        },
      });
      // Resolution honours the split: app hosts are platform, tenant
      // subdomains still resolve under the tenant domain.
      expect(
        service.resolveHost('saas.em.staging.commercians.com'),
      ).toMatchObject({ kind: 'platform', role: 'platformAdmin' });
      expect(service.resolveHost('acme.staging.ecomate.bd')).toMatchObject({
        kind: 'tenant',
        slug: 'acme',
      });
    });

    it('honours explicit PLATFORM_*_HOST env vars over derivation', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      process.env.PLATFORM_ADMIN_HOST = 'console.example.net';
      process.env.PLATFORM_API_HOST = 'api.example.net';
      process.env.PLATFORM_LANDING_HOST = 'site.example.net';

      const service = buildService();
      await service.onModuleInit();

      expect(service.getConfig().platformHosts).toEqual({
        landing: 'site.example.net',
        platformAdmin: 'console.example.net',
        platformApi: 'api.example.net',
        webhooks: 'api.example.net',
      });
      expect(service.landingUrl()).toBe('https://site.example.net');
      expect(service.adminUrl()).toBe('https://console.example.net');
    });

    it('rejects an app domain equal to the tenant domain', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      await expect(
        service.update({ appDomain: 'ecomate.bd' }),
      ).rejects.toThrow('must differ from the tenant domain');
    });

    it('rejects an app domain that is a subdomain or parent of the tenant domain', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      await expect(
        service.update({ appDomain: 'app.ecomate.bd' }),
      ).rejects.toThrow('must not be a subdomain or a parent');
      await expect(
        service.update({ appDomain: 'commercians.com' }),
      ).resolves.toMatchObject({ appDomain: 'commercians.com' });
      // Parent direction: tenant domain under the app domain.
      await expect(
        service.update({
          appDomain: 'commercians.com',
          primaryDomain: 'tenant.commercians.com',
        }),
      ).rejects.toThrow('must not be a subdomain or a parent');
    });

    it('rejects an app domain equal to a tenant alias base', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
      const service = buildService();
      await service.onModuleInit();

      await expect(
        service.update({ appDomain: 'alias.example' }),
      ).rejects.toThrow('must not be one of the tenant base domains');
    });

    it('setting the app domain re-derives console/API hosts but not landing', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      const next = await service.update({
        appDomain: 'em.staging.commercians.com',
      });

      expect(next.platformHosts).toEqual({
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.em.staging.commercians.com',
        platformApi: 'api.em.staging.commercians.com',
        webhooks: 'api.em.staging.commercians.com',
      });
      expect(next.adminUrl).toBe('https://saas.em.staging.commercians.com');
      expect(next.landingUrl).toBe('https://www.ecomate.bd');
    });

    it('clearing the app domain returns to legacy single-domain derivation', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      process.env.SAAS_APP_DOMAIN = 'em.staging.commercians.com';
      const service = buildService();
      await service.onModuleInit();
      expect(service.getConfig().appDomain).toBe(
        'em.staging.commercians.com',
      );

      const next = await service.update({ appDomain: '' });

      expect(next.appDomain).toBeUndefined();
      expect(next.platformHosts).toEqual({
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
        webhooks: 'api.ecomate.bd',
      });
    });

    it('a primary change with an app domain set moves no platform host', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      process.env.SAAS_APP_DOMAIN = 'em.staging.commercians.com';
      const service = buildService();
      await service.onModuleInit();

      const next = await service.update({
        primaryDomain: 'tenants.example',
        baseDomains: ['tenants.example'],
      });

      expect(next.platformHosts).toEqual({
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.em.staging.commercians.com',
        platformApi: 'api.em.staging.commercians.com',
        webhooks: 'api.em.staging.commercians.com',
      });
      // ...but the CNAME target follows the TENANT domain.
      expect(next.customDomainCname).toBe('cname.tenants.example');
    });

    it('a primary change re-derives the CNAME target in legacy mode too', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      const next = await service.update({
        primaryDomain: 'new.example',
        baseDomains: ['new.example'],
      });

      expect(next.customDomainCname).toBe('cname.new.example');
    });

    it('an explicit CNAME override survives a primary change', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      const next = await service.update({
        primaryDomain: 'new.example',
        baseDomains: ['new.example'],
        customDomainCname: 'cdn.other.example',
      });

      expect(next.customDomainCname).toBe('cdn.other.example');
    });

    it('ignores an invalid SAAS_APP_DOMAIN at boot instead of failing', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      process.env.SAAS_APP_DOMAIN = 'not a domain!!';

      const service = buildService();
      await service.onModuleInit();

      expect(service.getConfig().appDomain).toBeUndefined();
      expect(service.getConfig().platformHosts.platformAdmin).toBe(
        'saas.ecomate.bd',
      );
    });
  });

  describe('landing/console URLs', () => {
    it('bootstraps landing/admin URLs from PLATFORM_*_URL env', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      process.env.PLATFORM_LANDING_URL = 'http://localhost:3002';
      process.env.PLATFORM_ADMIN_URL = 'http://localhost:5174';

      const service = buildService();
      await service.onModuleInit();

      expect(service.landingUrl()).toBe('http://localhost:3002');
      expect(service.adminUrl()).toBe('http://localhost:5174');
    });

    it('a landing-host change re-derives the landing URL unless overridden', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      const next = await service.update({
        platformHosts: { landing: 'site.example.net' },
      });
      expect(next.landingUrl).toBe('https://site.example.net');

      // An explicit URL in the same update wins over re-derivation.
      const overridden = await service.update({
        platformHosts: { landing: 'other.example.net' },
        landingUrl: 'https://custom.example.org/landing',
      });
      expect(overridden.landingUrl).toBe(
        'https://custom.example.org/landing',
      );

      // Clearing the override derives from the current host again.
      const cleared = await service.update({ landingUrl: '' });
      expect(cleared.landingUrl).toBe('https://other.example.net');
    });

    it('rejects a non-http(s) landing/admin URL', async () => {
      const service = buildService();
      await service.onModuleInit();

      await expect(
        service.update({ landingUrl: 'ftp://files.example' }),
      ).rejects.toThrow('landingUrl must be a valid http(s) URL');
      await expect(
        service.update({ adminUrl: 'not-a-url' }),
      ).rejects.toThrow('adminUrl must be a valid http(s) URL');
    });

    it('rejects invalid hostnames in base domains, fallback, CNAME and hosts', async () => {
      const service = buildService();
      await service.onModuleInit();

      await expect(
        service.update({ baseDomains: ['ecomate.bd', 'bad host!!'] }),
      ).rejects.toThrow('is not a valid hostname');
      await expect(
        service.update({ fallbackDomain: 'no-dot' }),
      ).rejects.toThrow('is not a valid hostname');
      await expect(
        service.update({ customDomainCname: 'cname!' }),
      ).rejects.toThrow('must be a hostname');
      await expect(
        service.update({ platformHosts: { landing: 'bad host' } }),
      ).rejects.toThrow('is not a valid hostname');
    });

    it('a stored row predating the URL fields re-derives from the stored hosts', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'env.example';
      process.env.SAAS_BASE_DOMAINS = 'env.example';

      const service = buildService({
        primaryDomain: 'ecomate.bd',
        baseDomains: ['ecomate.bd'],
        fallbackDomain: null,
        customDomainCname: 'cname.ecomate.bd',
        allowExternalFallback: false,
        platformHosts: {
          landing: 'www.ecomate.bd',
          platformAdmin: 'saas.ecomate.bd',
          platformApi: 'api.ecomate.bd',
          webhooks: 'api.ecomate.bd',
        },
      });
      await service.onModuleInit();

      // NOT https://www.env.example (the env-derived value): the stored
      // hosts win, and the URLs derive from them.
      expect(service.landingUrl()).toBe('https://www.ecomate.bd');
      expect(service.adminUrl()).toBe('https://saas.ecomate.bd');
    });

    it('a form echo (derived value re-sent) does not block re-derivation', async () => {
      process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
      process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
      const service = buildService();
      await service.onModuleInit();

      // The console sends every field on every save: the derived hosts
      // and URLs come back verbatim alongside the new primary. They must
      // not pin the old derivation.
      const next = await service.update({
        primaryDomain: 'new.example',
        baseDomains: ['new.example'],
        platformHosts: {
          landing: 'www.ecomate.bd',
          platformAdmin: 'saas.ecomate.bd',
          platformApi: 'api.ecomate.bd',
          webhooks: 'api.ecomate.bd',
        },
        customDomainCname: 'cname.ecomate.bd',
        landingUrl: 'https://www.ecomate.bd',
        adminUrl: 'https://saas.ecomate.bd',
      });

      expect(next.platformHosts).toEqual({
        landing: 'www.new.example',
        platformAdmin: 'saas.new.example',
        platformApi: 'api.new.example',
        webhooks: 'api.new.example',
      });
      expect(next.customDomainCname).toBe('cname.new.example');
      expect(next.landingUrl).toBe('https://www.new.example');
      expect(next.adminUrl).toBe('https://saas.new.example');
    });
  });

  describe('primary-domain probe (Phase 8 item 25, D12)', () => {
    it('is healthy with no probe result yet', async () => {
      const service = buildService();
      await service.onModuleInit();
      expect(service.getPrimaryProbeResult()).toBeNull();
      expect(service.isPrimaryHealthy()).toBe(true);
    });

    it('a failing probe flips health to false', async () => {
      const service = buildService();
      await service.onModuleInit();
      service.setPrimaryProbeResult(false);
      expect(service.getPrimaryProbeResult()).toBe(false);
      expect(service.isPrimaryHealthy()).toBe(false);
    });

    it('a passing probe restores health', async () => {
      const service = buildService();
      await service.onModuleInit();
      service.setPrimaryProbeResult(false);
      expect(service.isPrimaryHealthy()).toBe(false);
      service.setPrimaryProbeResult(true);
      expect(service.isPrimaryHealthy()).toBe(true);
    });

    it('the SAAS_PRIMARY_UNHEALTHY flag still forces unhealthy as a manual override', async () => {
      const service = buildService();
      await service.onModuleInit();
      service.setPrimaryProbeResult(true);
      expect(service.isPrimaryHealthy()).toBe(true);
      process.env.SAAS_PRIMARY_UNHEALTHY = 'true';
      expect(service.isPrimaryHealthy()).toBe(false);
    });

    it('effectiveBaseDomain follows the probe (fallback while unhealthy)', async () => {
      process.env.SAAS_FALLBACK_DOMAIN = 'fallback.example';
      process.env.SAAS_ALLOW_EXTERNAL_FALLBACK = 'true';
      const service = buildService();
      await service.onModuleInit();
      expect(service.effectiveBaseDomain()).toBe('ecomate.bd');
      service.setPrimaryProbeResult(false);
      expect(service.effectiveBaseDomain()).toBe('fallback.example');
    });
  });
});
