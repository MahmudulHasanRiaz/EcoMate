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
      customDomainCname: 'cname.ecomate.bd',
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
      },
    });
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
});
