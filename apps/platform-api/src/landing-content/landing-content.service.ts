import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CreateLandingContentDto } from './dto/create-landing-content.dto';
import { UpdateLandingContentDto } from './dto/update-landing-content.dto';
import {
  LANDING_LIST_SECTIONS,
  LANDING_LOCALES,
  LANDING_SCALAR_SECTIONS,
  LANDING_SECTIONS,
} from './landing-content.constants';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class LandingContentService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public read for the landing app: active rows grouped by locale then
   * section. Exact shape (the landing depends on it):
   * - hero / contact: `{ field: value }` scalar maps (one row per field)
   * - capabilities: `{ sectionId: partialSectionObject }` (one row per
   *   section; the landing shallow-merges it over the built-in section)
   * - faq / testimonials / partners: `[{ key, ...value }]` lists, sorted
   *   by sortOrder then key
   * Sections with zero active rows are OMITTED — the landing falls back
   * to built-in content for missing sections. An empty table returns
   * `{ en: {}, bn: {} }`, never an error.
   */
  async publicGrouped(): Promise<
    Record<string, Record<string, unknown>>
  > {
    const rows = await this.prisma.landingContent.findMany({
      where: { isActive: true },
      orderBy: [
        { locale: 'asc' },
        { section: 'asc' },
        { sortOrder: 'asc' },
        { key: 'asc' },
      ],
    });

    const grouped: Record<string, Record<string, unknown>> = {
      en: {},
      bn: {},
    };

    for (const row of rows) {
      const locale = grouped[row.locale];
      // Rows with an unknown locale or section are never served (defence
      // in depth — validation should prevent them from existing).
      if (!locale) continue;
      if (LANDING_SCALAR_SECTIONS.has(row.section)) {
        const section = (locale[row.section] ?? {}) as Record<
          string,
          unknown
        >;
        section[row.key] = row.value;
        locale[row.section] = section;
      } else if (row.section === 'capabilities') {
        const section = (locale.capabilities ?? {}) as Record<
          string,
          unknown
        >;
        section[row.key] = row.value;
        locale.capabilities = section;
      } else if (LANDING_LIST_SECTIONS.has(row.section)) {
        const list = (locale[row.section] ?? []) as Record<string, unknown>[];
        list.push(
          isPlainObject(row.value)
            ? { key: row.key, ...row.value }
            : { key: row.key, value: row.value },
        );
        locale[row.section] = list;
      }
    }

    return grouped;
  }

  async list(query: {
    page?: string;
    limit?: string;
    section?: string;
    locale?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where: any = {};
    if (query.section && (LANDING_SECTIONS as readonly string[]).includes(query.section)) {
      where.section = query.section;
    }
    if (query.locale && (LANDING_LOCALES as readonly string[]).includes(query.locale)) {
      where.locale = query.locale;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.landingContent.findMany({
        where,
        orderBy: [
          { section: 'asc' },
          { locale: 'asc' },
          { sortOrder: 'asc' },
          { key: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.landingContent.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async create(dto: CreateLandingContentDto, actorId?: string) {
    try {
      const row = await this.prisma.landingContent.create({
        data: {
          section: dto.section,
          key: dto.key,
          locale: dto.locale,
          value: dto.value as any,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
      await this.audit.record({
        actorId,
        action: 'landing-content.create',
        entity: 'LandingContent',
        entityId: row.id,
        after: {
          section: row.section,
          key: row.key,
          locale: row.locale,
        },
      });
      return row;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A landing content row already exists for this section, key and locale',
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateLandingContentDto,
    actorId?: string,
  ) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    const data: Record<string, unknown> = {};
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    const updated = await this.prisma.landingContent.update({
      where: { id },
      data: data as any,
    });
    await this.audit.record({
      actorId,
      action: 'landing-content.update',
      entity: 'LandingContent',
      entityId: id,
      before: {
        value: row.value,
        sortOrder: row.sortOrder,
        isActive: row.isActive,
      },
      after: {
        value: updated.value,
        sortOrder: updated.sortOrder,
        isActive: updated.isActive,
      },
    });
    return updated;
  }

  async delete(id: string, actorId?: string) {
    const row = await this.prisma.landingContent.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Landing content row not found');
    await this.prisma.landingContent.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'landing-content.delete',
      entity: 'LandingContent',
      entityId: id,
      before: {
        section: row.section,
        key: row.key,
        locale: row.locale,
      },
    });
    return { deleted: true };
  }
}
