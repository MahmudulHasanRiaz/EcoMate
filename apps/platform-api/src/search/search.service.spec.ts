import { BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service';

function mockModel() {
  return { findMany: jest.fn().mockResolvedValue([]) };
}

const prisma: any = {
  tenant: mockModel(),
  platformUser: mockModel(),
  plan: mockModel(),
  invoice: mockModel(),
  payment: mockModel(),
  paymentProof: mockModel(),
  subscription: mockModel(),
  coupon: mockModel(),
  creditNote: mockModel(),
  paymentMethod: mockModel(),
  lead: mockModel(),
  tenantDomain: mockModel(),
  auditLog: mockModel(),
  platformUserInvite: mockModel(),
  landingContent: mockModel(),
};

const jobs = {
  status: jest.fn().mockReturnValue({
    jobs: [
      {
        name: 'trial-expiry',
        lastRunAt: '2026-11-18T07:00:00.000Z',
        lastResult: { counts: { trialsExpired: 1 }, errors: [] },
        lastError: null,
      },
      {
        name: 'reminders',
        lastRunAt: null,
        lastResult: null,
        lastError: 'SMTP not configured',
      },
    ],
  }),
};

const service = new SearchService(prisma as any, jobs as any);

beforeEach(() => {
  jest.clearAllMocks();
  // mockResolvedValue set inside one test survives clearAllMocks, so
  // re-apply the empty default to every model before each test.
  for (const model of Object.values(prisma)) {
    (model as any).findMany.mockResolvedValue([]);
  }
  jobs.status.mockReturnValue({
    jobs: [
      {
        name: 'trial-expiry',
        lastRunAt: '2026-11-18T07:00:00.000Z',
        lastResult: { counts: { trialsExpired: 1 }, errors: [] },
        lastError: null,
      },
      {
        name: 'reminders',
        lastRunAt: null,
        lastResult: null,
        lastError: 'SMTP not configured',
      },
    ],
  });
});

describe('SearchService', () => {
  it('returns grouped results with type, title, subtitle and link', async () => {
    prisma.tenant.findMany.mockResolvedValue([
      {
        id: 't-1',
        name: 'Fixround2 Store',
        slug: 'fixround2',
        ownerEmail: 'owner@example.com',
        status: 'TRIAL',
      },
    ]);
    const result = await service.search('fixround2', 'SUPERADMIN', {
      types: ['tenant'],
    });
    expect(result.q).toBe('fixround2');
    expect(result.total).toBe(1);
    expect(result.groups).toEqual([
      {
        type: 'tenant',
        label: 'Tenants',
        items: [
          {
            type: 'tenant',
            id: 't-1',
            title: 'Fixround2 Store',
            subtitle: 'fixround2 · owner@example.com',
            status: 'TRIAL',
            link: '/tenants/t-1',
          },
        ],
      },
    ]);
  });

  it('searches tenants by name, slug, owner email and phone', async () => {
    await service.search('01700', 'SUPERADMIN', { types: ['tenant'] });
    const where = prisma.tenant.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: '01700', mode: 'insensitive' } },
        { slug: { contains: '01700', mode: 'insensitive' } },
        { ownerEmail: { contains: '01700', mode: 'insensitive' } },
        { ownerPhone: { contains: '01700', mode: 'insensitive' } },
      ]),
    );
  });

  it('matches a query that IS a status value against the status column', async () => {
    await service.search('OPEN', 'SUPERADMIN', { types: ['invoice'] });
    const where = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([{ status: 'OPEN' }]));
  });

  it('applies the status filter and skips types without that status', async () => {
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't-1', name: 'A', slug: 'a', ownerEmail: 'a@x', status: 'TRIAL' },
    ]);
    const result = await service.search('acme', 'SUPERADMIN', {
      types: ['tenant', 'payment'],
      status: 'TRIAL',
    });
    expect(prisma.tenant.findMany.mock.calls[0][0].where.status).toBe('TRIAL');
    // Payments have no status vocabulary — never queried with a filter.
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(result.groups.map((g) => g.type)).toEqual(['tenant']);
  });

  it('derives plan/coupon/method status from isActive', async () => {
    await service.search('gold', 'SUPERADMIN', {
      types: ['plan'],
      status: 'INACTIVE',
    });
    expect(prisma.plan.findMany.mock.calls[0][0].where.isActive).toBe(false);
  });

  it('never queries Users-area types for BILLING or SUPPORT', async () => {
    for (const role of ['BILLING', 'SUPPORT']) {
      jest.clearAllMocks();
      await service.search('admin', role);
      expect(prisma.platformUser.findMany).not.toHaveBeenCalled();
      expect(prisma.platformUserInvite.findMany).not.toHaveBeenCalled();
      // …but tenants are still searchable for those roles.
      expect(prisma.tenant.findMany).toHaveBeenCalled();
    }
  });

  it('returns nothing for an unknown role', async () => {
    const result = await service.search('fixround2', 'NOPE');
    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
  });

  it('rejects queries that are too short, too long, or blank', async () => {
    await expect(service.search('a', 'SUPERADMIN')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.search('   ', 'SUPERADMIN')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.search('x'.repeat(101), 'SUPERADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown types and statuses', async () => {
    await expect(
      service.search('ab', 'SUPERADMIN', { types: ['widget'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.search('ab', 'SUPERADMIN', {
        types: ['tenant'],
        status: 'BOGUS',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clamps the per-type limit to 1..20', async () => {
    await service.search('ab', 'SUPERADMIN', {
      types: ['tenant'],
      limit: 100,
    });
    expect(prisma.tenant.findMany.mock.calls[0][0].take).toBe(20);
    await service.search('ab', 'SUPERADMIN', {
      types: ['tenant'],
      limit: 0,
    });
    expect(prisma.tenant.findMany.mock.calls[1][0].take).toBe(5);
  });

  it('searches billing jobs in memory by name, label and status', async () => {
    const byName = await service.search('trial-expiry', 'SUPERADMIN', {
      types: ['job'],
    });
    expect(byName.groups[0].items).toEqual([
      expect.objectContaining({
        type: 'job',
        id: 'trial-expiry',
        title: 'Trial expiry',
        status: 'OK',
        link: '/billing?tab=jobs',
      }),
    ]);

    const byLabel = await service.search('reminders', 'SUPERADMIN', {
      types: ['job'],
    });
    expect(byLabel.groups[0].items[0].status).toBe('ERROR');

    const byStatus = await service.search('ERROR', 'SUPERADMIN', {
      types: ['job'],
      status: 'ERROR',
    });
    expect(byStatus.groups[0].items.map((i) => i.id)).toEqual(['reminders']);
  });

  it('derives invite status and filters it in memory', async () => {
    prisma.platformUserInvite.findMany.mockResolvedValue([
      {
        id: 'i-1',
        email: 'pending@example.com',
        name: 'Pending',
        role: 'SUPPORT',
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: null,
      },
      {
        id: 'i-2',
        email: 'used@example.com',
        name: 'Used',
        role: 'BILLING',
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: new Date(),
      },
    ]);
    const result = await service.search('example', 'SUPERADMIN', {
      types: ['invite'],
      status: 'PENDING',
    });
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['i-1']);
    expect(result.groups[0].items[0].status).toBe('PENDING');
  });

  it('searches landing content by key, section and copy text', async () => {
    prisma.landingContent.findMany.mockResolvedValue([
      {
        id: 'lc-1',
        section: 'hero',
        key: 'hero.title',
        locale: 'en',
        value: { text: 'Sell more, stress less' },
        isActive: true,
      },
      {
        id: 'lc-2',
        section: 'faq',
        key: 'faq.1.q',
        locale: 'en',
        value: { text: 'How do refunds work?' },
        isActive: true,
      },
    ]);
    const result = await service.search('stress less', 'SUPERADMIN', {
      types: ['landing'],
    });
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['lc-1']);
    expect(result.groups[0].items[0].subtitle).toBe('hero · en');
  });

  it('links billing entities to their billing tab', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        number: 'INV-2611-0001',
        status: 'OPEN',
        total: '500.00',
        currency: 'BDT',
        tenant: { name: 'Fixround2 Store', slug: 'fixround2' },
      },
    ]);
    prisma.paymentMethod.findMany.mockResolvedValue([
      { id: 'm-1', name: 'bKash', type: 'BKASH', accountNumber: '01700', isActive: true },
    ]);
    const result = await service.search('00', 'SUPERADMIN', {
      types: ['invoice', 'method'],
    });
    const byType = Object.fromEntries(
      result.groups.map((g) => [g.type, g.items[0].link]),
    );
    expect(byType.invoice).toBe('/billing?tab=invoices');
    expect(byType.method).toBe('/settings/payment-methods');
  });

  it('omits empty groups and totals only returned items', async () => {
    const result = await service.search('zzz-no-match', 'SUPERADMIN');
    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
  });
});
