import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FeaturesService } from './features.service';

const FEATURE_ROW = {
  key: 'smtp_server',
  name: 'Smtp Server',
  description: null,
  category: 'O: Infrastructure',
  dependencies: [],
  unit: null,
  isActive: true,
  sortOrder: 77,
  kind: 'ADD_ON',
  scope: 'Email sending.',
  withoutAccess: 'No email sending.',
  addOnId: 'addon-smtp',
  addOn: {
    id: 'addon-smtp',
    slug: 'smtp-server',
    name: 'SMTP & Email Sending',
    price: 199,
    currency: 'BDT',
    isActive: true,
  },
};

function makeService() {
  const prisma: any = {
    feature: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    planVersion: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const addOns = { convertFromFeature: jest.fn() };
  const service = new FeaturesService(
    prisma as any,
    audit as any,
    addOns as any,
  );
  return { service, prisma, audit, addOns };
}

describe('FeaturesService.list', () => {
  it('maps the enum kind to Boss words and includes the linked add-on', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findMany.mockResolvedValue([FEATURE_ROW]);

    const rows = await service.list({});

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('add-on');
    expect(rows[0].addOn).toEqual({
      id: 'addon-smtp',
      slug: 'smtp-server',
      name: 'SMTP & Email Sending',
      price: 199,
      currency: 'BDT',
      isActive: true,
    });
  });

  it('filters by kind, category, and search', async () => {
    const { service, prisma } = makeService();
    await service.list({
      kind: 'add-on',
      category: 'O: Infrastructure',
      search: 'smtp',
    });

    expect(prisma.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'ADD_ON',
          category: 'O: Infrastructure',
          OR: expect.arrayContaining([
            { key: { contains: 'smtp', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  it('falls back to the content defaults when the row text is null', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findMany.mockResolvedValue([
      { ...FEATURE_ROW, scope: null, withoutAccess: null },
    ]);

    const rows = await service.list({});
    expect(rows[0].scope).toContain('Email sending');
    expect(rows[0].withoutAccess).toContain('No email balance');
  });
});

describe('FeaturesService.detail', () => {
  it('returns the plans whose versions include the key, flagging the latest', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(FEATURE_ROW);
    prisma.planVersion.findMany
      .mockResolvedValueOnce([
        {
          id: 'v2',
          planId: 'plan-1',
          version: 2,
          price: 1000,
          currency: 'BDT',
          plan: { id: 'plan-1', name: 'Growth', slug: 'growth', isActive: true },
        },
        {
          id: 'v1',
          planId: 'plan-1',
          version: 1,
          price: 900,
          currency: 'BDT',
          plan: { id: 'plan-1', name: 'Growth', slug: 'growth', isActive: true },
        },
      ])
      .mockResolvedValueOnce([
        { planId: 'plan-1', version: 1 },
        { planId: 'plan-1', version: 2 },
        { planId: 'plan-1', version: 3 },
      ]);

    const detail = await service.detail('smtp_server');

    expect(detail.key).toBe('smtp_server');
    expect(detail.dependencies).toEqual([]);
    // v3 exists but does not include the key, so neither listed version
    // is the latest.
    expect(detail.plans).toEqual([
      expect.objectContaining({ version: 2, isLatest: false }),
      expect.objectContaining({ version: 1, isLatest: false }),
    ]);
    expect(prisma.planVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { features: { has: 'smtp_server' } },
            { features: { has: '*' } },
          ],
        },
      }),
    );
  });

  it("includes wildcard ('*') plan versions — a '*' plan includes every feature", async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(FEATURE_ROW);
    prisma.planVersion.findMany
      .mockResolvedValueOnce([
        {
          id: 'v1',
          planId: 'plan-wild',
          version: 1,
          price: 0,
          currency: 'BDT',
          plan: {
            id: 'plan-wild',
            name: 'All Access',
            slug: 'all-access',
            isActive: true,
          },
        },
      ])
      .mockResolvedValueOnce([{ planId: 'plan-wild', version: 1 }]);

    const detail = await service.detail('smtp_server');

    expect(detail.plans).toEqual([
      expect.objectContaining({
        planId: 'plan-wild',
        planSlug: 'all-access',
        version: 1,
        isLatest: true,
      }),
    ]);
    expect(prisma.planVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ features: { has: '*' } }]),
        }),
      }),
    );
  });

  it('404s for an unknown key', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(null);

    await expect(service.detail('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('FeaturesService.update', () => {
  it('updates kind + text and audits a kind change', async () => {
    const { service, prisma, audit } = makeService();
    prisma.feature.findUnique.mockResolvedValue({
      ...FEATURE_ROW,
      kind: 'INITIAL',
      addOnId: null,
      addOn: null,
    });
    prisma.feature.update.mockResolvedValue({
      ...FEATURE_ROW,
      kind: 'ADD_ON',
      scope: 'New scope.',
      addOn: null,
    });

    const updated = await service.update(
      'smtp_server',
      { kind: 'add-on', scope: 'New scope.' },
      'actor-1',
    );

    expect(updated.kind).toBe('add-on');
    expect(updated.scope).toBe('New scope.');
    expect(prisma.feature.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'smtp_server' },
        data: { kind: 'ADD_ON', scope: 'New scope.' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'feature.kind.change',
        entity: 'Feature',
        entityId: 'smtp_server',
        before: expect.objectContaining({ kind: 'initial' }),
      }),
    );
  });

  it('rejects an empty patch', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(FEATURE_ROW);

    await expect(service.update('smtp_server', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s for an unknown key', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(null);

    await expect(
      service.update('ghost', { kind: 'initial' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FeaturesService.bulkKind', () => {
  it('marks only the keys whose kind actually changes and audits each', async () => {
    const { service, prisma, audit } = makeService();
    prisma.feature.findMany.mockResolvedValue([
      { key: 'pos_system', kind: 'INITIAL' },
      { key: 'smtp_server', kind: 'ADD_ON' },
    ]);

    const result = await service.bulkKind(
      { keys: ['pos_system', 'smtp_server'], kind: 'add-on' },
      'actor-1',
    );

    expect(result).toEqual({
      kind: 'add-on',
      requested: 2,
      updated: 1,
      keys: ['pos_system'],
    });
    expect(prisma.feature.updateMany).toHaveBeenCalledWith({
      where: { key: { in: ['pos_system'] } },
      data: { kind: 'ADD_ON' },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature.kind.change',
        entityId: 'pos_system',
        after: { kind: 'add-on', bulk: true },
      }),
    );
  });

  it('400s listing unknown keys', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findMany.mockResolvedValue([
      { key: 'pos_system', kind: 'INITIAL' },
    ]);

    await expect(
      service.bulkKind({ keys: ['pos_system', 'ghost'], kind: 'initial' }),
    ).rejects.toThrow('Unknown feature key(s): ghost');
  });
});

describe('FeaturesService.convertToAddOn', () => {
  it('delegates dry-run + execute to AddOnsService.convertFromFeature', async () => {
    const { service, prisma, addOns } = makeService();
    prisma.feature.findUnique.mockResolvedValue({
      key: 'seo_suite',
      addOnId: null,
    });
    addOns.convertFromFeature.mockResolvedValue({
      dryRun: true,
      featureKey: 'seo_suite',
    });

    const result = await service.convertToAddOn(
      'seo_suite',
      { price: 99, dryRun: true },
      'actor-1',
    );

    expect(result).toEqual({ dryRun: true, featureKey: 'seo_suite' });
    expect(addOns.convertFromFeature).toHaveBeenCalledWith(
      { featureKey: 'seo_suite', price: 99, dryRun: true },
      'actor-1',
    );
  });

  it('409s when the feature is already sold as an add-on', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue({
      key: 'smtp_server',
      addOnId: 'addon-smtp',
    });

    await expect(
      service.convertToAddOn('smtp_server', { price: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s for an unknown key', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(null);

    await expect(
      service.convertToAddOn('ghost', { price: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
