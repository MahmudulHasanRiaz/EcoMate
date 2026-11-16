import { NotFoundException } from '@nestjs/common';
import {
  AUDIT_EXPORT_ROW_CAP,
  AuditQueryService,
  csvCell,
} from './audit-query.service';

function makeRow(overrides: any = {}) {
  return {
    id: 'log-1',
    actorType: 'PLATFORM',
    actorId: 'user-1',
    actor: { id: 'user-1', email: 'admin@ecomate.test', name: 'Admin' },
    tenantId: null,
    tenant: null,
    action: 'users.create',
    entity: 'PlatformUser',
    entityId: 'user-2',
    before: null,
    after: { email: 'new@ecomate.test' },
    ip: '127.0.0.1',
    userAgent: 'test',
    createdAt: new Date('2026-11-16T10:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    auditLog: {
      findMany: jest.fn().mockResolvedValue([makeRow()]),
      findUnique: jest.fn().mockResolvedValue(makeRow()),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  prisma.$transaction = jest.fn(async (input: any) => Promise.all(input));
  return { prisma, service: new AuditQueryService(prisma as any) };
}

describe('AuditQueryService', () => {
  it('lists with filters, search and page meta', async () => {
    const { service, prisma } = makeService();

    const result = await service.list({
      page: '1',
      limit: '20',
      actorId: 'user-1',
      action: 'users',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-30T00:00:00Z',
      search: 'PlatformUser',
    });

    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.actorId).toBe('user-1');
    expect(where.action).toEqual({
      contains: 'users',
      mode: 'insensitive',
    });
    expect(where.createdAt.gte).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(where.createdAt.lte).toEqual(new Date('2026-11-30T00:00:00Z'));
    expect(where.OR).toEqual([
      { action: { contains: 'PlatformUser', mode: 'insensitive' } },
      { entity: { contains: 'PlatformUser', mode: 'insensitive' } },
    ]);
    expect(prisma.auditLog.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    });
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('ignores unparseable from/to dates instead of crashing', async () => {
    const { service, prisma } = makeService();

    await service.list({ from: 'not-a-date', to: 'also-not-a-date' });

    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toBeUndefined();
  });

  it('returns one entry and 404s on a missing id', async () => {
    const { service, prisma } = makeService();

    const row = await service.detail('log-1');
    expect(row.id).toBe('log-1');

    prisma.auditLog.findUnique.mockResolvedValue(null);
    await expect(service.detail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('caps exports and flags truncation', async () => {
    const { service, prisma } = makeService();

    const normal = await service.exportRows({});
    expect(normal.truncated).toBe(false);
    expect(normal.rows).toHaveLength(1);

    prisma.auditLog.findMany.mockResolvedValue(
      Array.from({ length: AUDIT_EXPORT_ROW_CAP + 1 }, (_, i) =>
        makeRow({ id: `log-${i}` }),
      ),
    );
    const capped = await service.exportRows({});
    expect(capped.truncated).toBe(true);
    expect(capped.rows).toHaveLength(AUDIT_EXPORT_ROW_CAP);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: AUDIT_EXPORT_ROW_CAP + 1 }),
    );
  });

  it('builds RFC-4180 CSV with quoting and JSON payloads', () => {
    const { service } = makeService();

    const csv = service.toCsv([
      makeRow({
        action: 'note, with "quotes"',
        after: { note: 'line1\nline2' },
        actor: { email: 'a@b.test', name: 'A, B' },
      }),
    ]);

    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,createdAt,actorType,actorId,actorEmail');
    expect(csv).toContain('"note, with ""quotes"""');
    expect(csv).toContain('"A, B"');
    expect(csv).toContain('"{""note"":""line1\\nline2""}"');
  });

  it('csvCell handles plain, empty and numeric values', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(true)).toBe('true');
    expect(csvCell('has,comma')).toBe('"has,comma"');
  });
});
