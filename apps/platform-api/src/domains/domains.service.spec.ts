jest.mock('node:dns/promises', () => ({
  resolveTxt: jest.fn(),
  resolveCname: jest.fn(),
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import { DomainsService } from './domains.service';

const resolveTxtMock = resolveTxt as unknown as jest.Mock;
const resolveCnameMock = resolveCname as unknown as jest.Mock;

const config = {
  primaryDomain: 'ecomate.bd',
  baseDomains: ['ecomate.bd', 'alias.example'],
  customDomainCname: 'cname.ecomate.bd',
};

function makeService(overrides: {
  tenant?: any;
  create?: any;
} = {}) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.tenant ?? {
          id: 'tenant-1',
          slug: 'acme',
          planVersion: null,
          subscription: null,
        },
      ),
    },
    tenantDomain: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue(overrides.create ?? {
        id: 'dom-1',
        host: 'shop.example.com',
        type: 'CUSTOM',
        status: 'PENDING',
        verificationToken: 'token-1',
      }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const domainConfig = {
    getConfig: () => config,
    resolveHost: jest.fn().mockReturnValue({ kind: 'custom', host: 'shop.example.com' }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    domainConfig,
    audit,
    service: new DomainsService(prisma, domainConfig as any, audit as any),
  };
}

describe('DomainsService — add', () => {
  it('creates a custom domain with a verification token and DNS instructions', async () => {
    const { service, prisma } = makeService();

    const result = await service.addDomain(
      'tenant-1',
      { host: 'Shop.Example.com', type: 'CUSTOM' } as any,
      'u1',
    );

    expect(prisma.tenantDomain.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        host: 'shop.example.com',
        type: 'CUSTOM',
        status: 'PENDING',
        isPrimary: false,
        verificationToken: expect.stringMatching(/^[0-9a-f]{48}$/),
      }),
    });
    expect(result.dns).toEqual({
      cname: { name: 'shop.example.com', value: 'cname.ecomate.bd' },
      txt: {
        name: '_ecomate-verify.shop.example.com',
        value: expect.stringMatching(/^[0-9a-f]{48}$/),
      },
    });
  });

  it('rejects platform and base-domain hosts when added as custom', async () => {
    const { service, domainConfig } = makeService();

    domainConfig.resolveHost.mockReturnValueOnce({
      kind: 'platform',
      role: 'landing',
      host: 'www.ecomate.bd',
    });
    await expect(
      service.addDomain('tenant-1', {
        host: 'www.ecomate.bd',
        type: 'CUSTOM',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    domainConfig.resolveHost.mockReturnValueOnce({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });
    await expect(
      service.addDomain('tenant-1', {
        host: 'acme.ecomate.bd',
        type: 'CUSTOM',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('infers SUBDOMAIN for the tenant own base-domain host', async () => {
    const { service, prisma, domainConfig } = makeService();
    domainConfig.resolveHost.mockReturnValueOnce({
      kind: 'tenant',
      slug: 'acme',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'acme.ecomate.bd',
      isAlias: false,
    });

    const result = await service.addDomain('tenant-1', {
      host: 'acme.ecomate.bd',
    } as any);

    expect(prisma.tenantDomain.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        host: 'acme.ecomate.bd',
        type: 'SUBDOMAIN',
        verificationToken: null,
      }),
    });
    expect(result.dns).toBeNull();
  });

  it('rejects a base-domain host that belongs to another tenant', async () => {
    const { service, domainConfig } = makeService();
    domainConfig.resolveHost.mockReturnValueOnce({
      kind: 'tenant',
      slug: 'other',
      baseDomain: 'ecomate.bd',
      canonicalHost: 'other.ecomate.bd',
      isAlias: false,
    });

    await expect(
      service.addDomain('tenant-1', { host: 'other.ecomate.bd' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['localhost', 'backend', '127.0.0.1', 'not_a_host', 'no-dot'])(
    'rejects internal/invalid host %s',
    async (host) => {
      const { service } = makeService();
      await expect(
        service.addDomain('tenant-1', { host } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('maps a duplicate host to a generic conflict', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.addDomain('tenant-1', { host: 'shop.example.com' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists all tenant domains with tenant context', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findMany.mockResolvedValue([
      {
        id: 'dom-1',
        host: 'shop.example.com',
        status: 'PENDING',
        tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' },
      },
    ]);

    const result = await service.listAll({
      status: 'PENDING',
      search: 'acme',
    });

    expect(prisma.tenantDomain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          OR: expect.any(Array),
        }),
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
        },
      }),
    );
    expect(result.meta.total).toBe(1);
  });

  it('forces a recheck and audits the result', async () => {
    const { service, prisma, audit } = makeService();
    prisma.tenantDomain.findUnique.mockResolvedValue({
      id: 'dom-1',
      tenantId: 'tenant-1',
    });
    prisma.tenantDomain.findFirst.mockResolvedValue({
      id: 'dom-1',
      tenantId: 'tenant-1',
      host: 'acme.ecomate.bd',
      type: 'SUBDOMAIN',
      status: 'VERIFIED',
      verificationToken: null,
    });

    const result = await service.recheck('dom-1', 'admin-1');

    expect(result.verified).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.domain.recheck' }),
    );
  });

  it('enforces the custom_domain plan feature when a plan exists', async () => {
    const { service } = makeService({
      tenant: {
        id: 'tenant-1',
        slug: 'acme',
        planVersion: null,
        subscription: { planVersion: { features: ['admin_products'] } },
      },
    });

    await expect(
      service.addDomain('tenant-1', { host: 'shop.example.com' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([['custom_domain'], ['*']])(
    'allows custom domains for plan features %s',
    async (feature) => {
      const { service } = makeService({
        tenant: {
          id: 'tenant-1',
          slug: 'acme',
          planVersion: null,
          subscription: { planVersion: { features: [feature] } },
        },
      });

      await expect(
        service.addDomain('tenant-1', { host: 'shop.example.com' } as any),
      ).resolves.toMatchObject({ domain: expect.any(Object) });
    },
  );
});

describe('DomainsService — verify', () => {
  const customDomain = {
    id: 'dom-1',
    tenantId: 'tenant-1',
    host: 'shop.example.com',
    type: 'CUSTOM',
    status: 'PENDING',
    verificationToken: 'abc123',
    isPrimary: false,
  };

  beforeEach(() => {
    resolveTxtMock.mockReset();
    resolveCnameMock.mockReset();
  });

  it('verifies ownership + routing and promotes the custom domain to primary', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findFirst.mockResolvedValue(customDomain);
    resolveTxtMock.mockResolvedValue([['abc', '123']]);
    resolveCnameMock.mockResolvedValue(['cname.ecomate.bd.']);
    prisma.tenantDomain.update.mockResolvedValue({
      ...customDomain,
      status: 'VERIFIED',
      isPrimary: true,
    });

    const result = await service.verify('tenant-1', 'dom-1', 'u1');

    expect(result.verified).toBe(true);
    expect(result.checks.txt.found).toEqual(['abc123']);
    expect(prisma.tenantDomain.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', id: { not: 'dom-1' } },
      data: { isPrimary: false },
    });
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'dom-1' },
      data: expect.objectContaining({
        status: 'VERIFIED',
        isPrimary: true,
        tlsStatus: 'PENDING',
      }),
    });
  });

  it('keeps the domain pending and records the check when DNS is incomplete', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findFirst.mockResolvedValue(customDomain);
    resolveTxtMock.mockResolvedValue([['wrong']]);
    resolveCnameMock.mockRejectedValue(new Error('ENOTFOUND'));
    prisma.tenantDomain.update.mockResolvedValue(customDomain);

    const result = await service.verify('tenant-1', 'dom-1');

    expect(result.verified).toBe(false);
    expect(result.checks.txt.ok).toBe(false);
    expect(result.checks.cname.ok).toBe(false);
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'dom-1' },
      data: { lastCheckedAt: expect.any(Date) },
    });
    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalled();
  });

  it('requires both the TXT proof and the CNAME target', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findFirst.mockResolvedValue(customDomain);
    resolveTxtMock.mockResolvedValue([['abc123']]);
    resolveCnameMock.mockResolvedValue(['other.example.com']);
    prisma.tenantDomain.update.mockResolvedValue(customDomain);

    const result = await service.verify('tenant-1', 'dom-1');
    expect(result.verified).toBe(false);
    expect(result.checks.txt.ok).toBe(true);
    expect(result.checks.cname.ok).toBe(false);
  });

  it('rejects an unknown tenant/domain pair', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findFirst.mockResolvedValue(null);
    await expect(service.verify('tenant-1', 'dom-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('DomainsService — remove + TLS allowlist', () => {
  it('removes a custom domain and restores the subdomain as primary', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findFirst
      .mockResolvedValueOnce({
        id: 'dom-1',
        tenantId: 'tenant-1',
        host: 'shop.example.com',
        type: 'CUSTOM',
        isPrimary: true,
      })
      .mockResolvedValueOnce({ id: 'sub-1', type: 'SUBDOMAIN' });

    const result = await service.remove('tenant-1', 'dom-1', 'u1');
    expect(result.deleted).toBe(true);
    expect(prisma.tenantDomain.delete).toHaveBeenCalledWith({
      where: { id: 'dom-1' },
    });
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { isPrimary: true },
    });
  });

  it('refuses to remove the tenant subdomain', async () => {
    const { service, prisma } = makeService();
    prisma.tenantDomain.findFirst.mockResolvedValue({
      id: 'sub-1',
      tenantId: 'tenant-1',
      type: 'SUBDOMAIN',
    });
    await expect(service.remove('tenant-1', 'sub-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows known tenant hosts for on-demand TLS only', async () => {
    const { service, prisma } = makeService();

    prisma.tenantDomain.findUnique.mockResolvedValue({
      type: 'SUBDOMAIN',
      status: 'PENDING',
      tenant: { status: 'ACTIVE' },
    });
    expect(await service.isTlsHostAllowed('ACME.ecomate.bd.')).toBe(true);

    prisma.tenantDomain.findUnique.mockResolvedValue({
      type: 'CUSTOM',
      status: 'PENDING',
      tenant: { status: 'ACTIVE' },
    });
    expect(await service.isTlsHostAllowed('shop.example.com')).toBe(false);

    prisma.tenantDomain.findUnique.mockResolvedValue({
      type: 'CUSTOM',
      status: 'VERIFIED',
      tenant: { status: 'ACTIVE' },
    });
    expect(await service.isTlsHostAllowed('shop.example.com')).toBe(true);

    prisma.tenantDomain.findUnique.mockResolvedValue({
      type: 'SUBDOMAIN',
      status: 'PENDING',
      tenant: { status: 'DELETED' },
    });
    expect(await service.isTlsHostAllowed('gone.ecomate.bd')).toBe(false);

    prisma.tenantDomain.findUnique.mockResolvedValue(null);
    expect(await service.isTlsHostAllowed('unknown.example.com')).toBe(false);
  });
});

describe('DomainsService — TLS allowlist for unstored base-domain hosts', () => {
  // A primary-domain move leaves stored SUBDOMAIN rows on the OLD base,
  // so {slug}.{new base} has no TenantDomain row — but the backend
  // resolver is dynamic and serves it, so the TLS ask gate must allow it
  // (otherwise Caddy aborts the handshake for the new host).
  function tenantResolution(slug: string) {
    return {
      kind: 'tenant',
      slug,
      baseDomain: 'staging.faah.net',
      canonicalHost: `${slug}.staging.faah.net`,
      isAlias: false,
    };
  }

  it('allows a {slug}.{base} host with no stored row when the tenant exists', async () => {
    const { service, prisma, domainConfig } = makeService();
    prisma.tenantDomain.findUnique.mockResolvedValue(null);
    (domainConfig.resolveHost as jest.Mock).mockReturnValue(
      tenantResolution('acme'),
    );
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      status: 'ACTIVE',
    });

    expect(await service.isTlsHostAllowed('acme.staging.faah.net')).toBe(
      true,
    );
    // Slug lookup hits the unique index on Tenant.slug.
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
      select: { status: true },
    });
  });

  it('denies a {slug}.{base} host when no tenant owns the slug', async () => {
    const { service, prisma, domainConfig } = makeService();
    prisma.tenantDomain.findUnique.mockResolvedValue(null);
    (domainConfig.resolveHost as jest.Mock).mockReturnValue(
      tenantResolution('ghost'),
    );
    prisma.tenant.findUnique.mockResolvedValue(null);

    expect(await service.isTlsHostAllowed('ghost.staging.faah.net')).toBe(
      false,
    );
  });

  it('denies a {slug}.{base} host whose tenant is deleted', async () => {
    const { service, prisma, domainConfig } = makeService();
    prisma.tenantDomain.findUnique.mockResolvedValue(null);
    (domainConfig.resolveHost as jest.Mock).mockReturnValue(
      tenantResolution('gone'),
    );
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-9',
      slug: 'gone',
      status: 'DELETED',
    });

    expect(await service.isTlsHostAllowed('gone.staging.faah.net')).toBe(
      false,
    );
  });

  it('denies non-tenant resolutions even when a tenant row exists', async () => {
    const { service, prisma, domainConfig } = makeService();
    prisma.tenantDomain.findUnique.mockResolvedValue(null);
    // Reserved/dotted slugs resolve as 'unknown' in DomainConfigService —
    // the gate must never fall through to a tenant lookup for them.
    (domainConfig.resolveHost as jest.Mock).mockReturnValue({
      kind: 'unknown',
      host: 'www.staging.faah.net',
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'www',
      status: 'ACTIVE',
    });

    expect(await service.isTlsHostAllowed('www.staging.faah.net')).toBe(
      false,
    );
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('keeps custom-domain rules: unverified denied, verified/active allowed', async () => {
    const { service, prisma } = makeService();

    prisma.tenantDomain.findUnique.mockResolvedValue({
      type: 'CUSTOM',
      status: 'PENDING',
      tenant: { status: 'ACTIVE' },
    });
    expect(await service.isTlsHostAllowed('shop.example.com')).toBe(false);

    prisma.tenantDomain.findUnique.mockResolvedValue({
      type: 'CUSTOM',
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    });
    expect(await service.isTlsHostAllowed('shop.example.com')).toBe(true);
  });
});
