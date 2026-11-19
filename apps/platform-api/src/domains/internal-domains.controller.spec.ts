import { NotFoundException } from '@nestjs/common';
import { InternalDomainsController } from './internal-domains.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const DOMAIN_ID = '33333333-3333-4333-8333-333333333333';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOMAIN_ID,
    tenantId: TENANT_ID,
    host: 'shop.example.com',
    type: 'CUSTOM',
    baseDomain: null,
    isPrimary: false,
    verificationToken: 'tok-secret-123',
    status: 'PENDING',
    tlsStatus: null,
    verifiedAt: null,
    lastCheckedAt: null,
    createdAt: new Date('2026-11-18T00:00:00.000Z'),
    updatedAt: new Date('2026-11-18T00:00:00.000Z'),
    ...overrides,
  };
}

function makeController() {
  const domains = {
    list: jest.fn(),
    addDomain: jest.fn(),
    recheck: jest.fn(),
    remove: jest.fn(),
  };
  const domainConfig = {
    getConfig: jest.fn().mockReturnValue({
      primaryDomain: 'ecomate.bd',
      customDomainCname: 'cname.ecomate.bd',
    }),
  };
  const prisma = {
    tenantDomain: { findFirst: jest.fn() },
  };
  return {
    domains,
    domainConfig,
    prisma,
    controller: new InternalDomainsController(
      domains as any,
      domainConfig as any,
      prisma as any,
    ),
  };
}

describe('InternalDomainsController', () => {
  it('lists domains shaped without the verification token', async () => {
    const { controller, domains } = makeController();
    domains.list.mockResolvedValue([
      makeRow(),
      makeRow({
        id: '44444444-4444-4444-8444-444444444444',
        host: 'mystore.ecomate.bd',
        type: 'SUBDOMAIN',
        verificationToken: null,
        status: 'ACTIVE',
        isPrimary: true,
      }),
    ]);

    const result = await controller.list(TENANT_ID);

    expect(domains.list).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toHaveLength(2);
    // The token never appears as a field in any row — it only shows
    // up as the TXT value inside the DNS instructions, which is its
    // purpose (the tenant must publish it).
    for (const view of result) {
      expect(view).not.toHaveProperty('verificationToken');
    }
    // The pending custom domain carries its DNS instructions…
    expect(result[0].dns).toEqual({
      cname: { name: 'shop.example.com', value: 'cname.ecomate.bd' },
      txt: {
        name: '_ecomate-verify.shop.example.com',
        value: 'tok-secret-123',
      },
    });
    // …the platform subdomain does not.
    expect(result[1].dns).toBeNull();
  });

  it('omits DNS instructions for a verified custom domain', async () => {
    const { controller, domains } = makeController();
    domains.list.mockResolvedValue([
      makeRow({ status: 'VERIFIED', isPrimary: true }),
    ]);

    const [view] = await controller.list(TENANT_ID);
    expect(view.dns).toBeNull();
  });

  it('adds a domain forcing type CUSTOM and strips the token', async () => {
    const { controller, domains } = makeController();
    domains.addDomain.mockResolvedValue({
      domain: makeRow(),
      dns: {
        cname: { name: 'shop.example.com', value: 'cname.ecomate.bd' },
        txt: {
          name: '_ecomate-verify.shop.example.com',
          value: 'tok-secret-123',
        },
      },
    });

    const result = await controller.add(TENANT_ID, { host: 'shop.example.com' });

    expect(domains.addDomain).toHaveBeenCalledWith(TENANT_ID, {
      host: 'shop.example.com',
      type: 'CUSTOM',
    });
    expect(result.domain).not.toHaveProperty('verificationToken');
    expect(result.dns?.txt.value).toBe('tok-secret-123');
  });

  it('add passes a caller-supplied SUBDOMAIN type through as CUSTOM', async () => {
    const { controller, domains } = makeController();
    domains.addDomain.mockResolvedValue({ domain: makeRow(), dns: null });

    await controller.add(TENANT_ID, {
      host: 'mystore.ecomate.bd',
      type: 'SUBDOMAIN',
    });

    expect(domains.addDomain).toHaveBeenCalledWith(TENANT_ID, {
      host: 'mystore.ecomate.bd',
      type: 'CUSTOM',
    });
  });

  it('recheck 404s when the domain belongs to another tenant', async () => {
    const { controller, domains, prisma } = makeController();
    prisma.tenantDomain.findFirst.mockResolvedValue(null);

    await expect(controller.recheck(TENANT_ID, DOMAIN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.tenantDomain.findFirst).toHaveBeenCalledWith({
      where: { id: DOMAIN_ID, tenantId: TENANT_ID },
      select: { id: true },
    });
    expect(domains.recheck).not.toHaveBeenCalled();
  });

  it('recheck shapes checks without leaking the TXT token', async () => {
    const { controller, domains, prisma } = makeController();
    prisma.tenantDomain.findFirst.mockResolvedValue({ id: DOMAIN_ID });
    domains.recheck.mockResolvedValue({
      verified: false,
      domain: makeRow(),
      checks: {
        txt: {
          ok: false,
          expected: 'tok-secret-123',
          found: [],
        },
        cname: {
          ok: true,
          expected: 'cname.ecomate.bd',
          found: ['cname.ecomate.bd.'],
        },
      },
      dns: {
        cname: { name: 'shop.example.com', value: 'cname.ecomate.bd' },
        txt: {
          name: '_ecomate-verify.shop.example.com',
          value: 'tok-secret-123',
        },
      },
    });

    const result = await controller.recheck(TENANT_ID, DOMAIN_ID);

    expect(domains.recheck).toHaveBeenCalledWith(DOMAIN_ID);
    expect(result.verified).toBe(false);
    // TXT check keeps only the ok flag — the expected value IS the token.
    expect(result.checks.txt).toEqual({ ok: false });
    // CNAME data is public DNS, so it stays.
    expect(result.checks.cname).toEqual({
      ok: true,
      expected: 'cname.ecomate.bd',
      found: ['cname.ecomate.bd.'],
    });
    expect(result.domain).not.toHaveProperty('verificationToken');
  });

  it('remove delegates tenant-scoped to the service', async () => {
    const { controller, domains } = makeController();
    domains.remove.mockResolvedValue({ deleted: true, domainId: DOMAIN_ID });

    await expect(controller.remove(TENANT_ID, DOMAIN_ID)).resolves.toEqual({
      deleted: true,
      domainId: DOMAIN_ID,
    });
    expect(domains.remove).toHaveBeenCalledWith(TENANT_ID, DOMAIN_ID);
  });

  it('recheck for another tenant id 404s even when the domain exists', async () => {
    const { controller, prisma } = makeController();
    // The row exists, but under a different tenant — the scoped lookup
    // returns nothing.
    prisma.tenantDomain.findFirst.mockResolvedValue(null);

    await expect(
      controller.recheck(OTHER_TENANT_ID, DOMAIN_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
