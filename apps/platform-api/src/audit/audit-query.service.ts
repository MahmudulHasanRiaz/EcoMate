import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';

export interface AuditQuery {
  page?: string;
  limit?: string;
  actorId?: string;
  tenantId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  from?: string;
  to?: string;
  search?: string;
}

/** Hard cap on export rows — the payload carries `truncated` past it. */
export const AUDIT_EXPORT_ROW_CAP = 5000;

const actorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const tenantSelect = {
  id: true,
  slug: true,
  name: true,
} as const;

/** RFC 4180: quote when the field holds a comma, quote or newline. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PlatformPrismaService) {}

  private buildWhere(query: AuditQuery): any {
    const where: any = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action) {
      where.action = { contains: query.action, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      const createdAt: any = {};
      if (query.from) {
        const from = new Date(query.from);
        if (!Number.isNaN(from.getTime())) createdAt.gte = from;
      }
      if (query.to) {
        const to = new Date(query.to);
        if (!Number.isNaN(to.getTime())) createdAt.lte = to;
      }
      if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
    }
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entity: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async list(query: AuditQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = this.buildWhere(query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: actorSelect }, tenant: { select: tenantSelect } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: string) {
    const row = await this.prisma.auditLog.findUnique({
      where: { id },
      include: { actor: { select: actorSelect }, tenant: { select: tenantSelect } },
    });
    if (!row) throw new NotFoundException('Audit entry not found');
    return row;
  }

  async exportRows(query: AuditQuery) {
    const where = this.buildWhere(query);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: AUDIT_EXPORT_ROW_CAP + 1,
      include: { actor: { select: actorSelect }, tenant: { select: tenantSelect } },
    });
    const truncated = rows.length > AUDIT_EXPORT_ROW_CAP;
    return { rows: truncated ? rows.slice(0, AUDIT_EXPORT_ROW_CAP) : rows, truncated };
  }

  toCsv(rows: any[]): string {
    const header = [
      'id',
      'createdAt',
      'actorType',
      'actorId',
      'actorEmail',
      'actorName',
      'tenantId',
      'tenantSlug',
      'action',
      'entity',
      'entityId',
      'ip',
      'userAgent',
      'before',
      'after',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt,
          row.actorType,
          row.actorId,
          row.actor?.email,
          row.actor?.name,
          row.tenantId,
          row.tenant?.slug,
          row.action,
          row.entity,
          row.entityId,
          row.ip,
          row.userAgent,
          row.before,
          row.after,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\n') + '\n';
  }
}
