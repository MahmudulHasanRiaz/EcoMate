import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import {
  deriveLegacyMedia,
  hasMediaInput,
  previousMediaOf,
  resolveMediaWithLegacyFallback,
  resolveMediaWrite,
} from '../common/media/media.service-helpers';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CreateCaseStudyDto } from './dto/create-case-study.dto';
import { UpdateCaseStudyDto } from './dto/update-case-study.dto';

/**
 * Case studies (Landing CMS item 19): operator CRUD + the public
 * published-only reads the landing uses. Role gating lives on the
 * controller (reads READ_ROLES, writes SUPERADMIN/BILLING — same as
 * landing-content, since edits reach the public site); every write is
 * audited. The public reads NEVER return an unpublished study — an
 * unpublished slug is a 404, indistinguishable from a missing one.
 */
@Injectable()
export class CaseStudiesService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Wire shape: resolved media (new fields win, legacy fallback —
   * §4.3), in the style of BlogService.toPostWire. The legacy fields
   * stay in the payload (additive); nothing is removed.
   */
  private toStudyWire(row: any) {
    return {
      ...row,
      ...resolveMediaWithLegacyFallback(row),
    };
  }

  /** Public list for the landing: published only, newest first. */
  async publicList() {
    const rows = await this.prisma.caseStudy.findMany({
      where: { isPublished: true },
      orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
    });
    return rows.map((row: any) => this.toStudyWire(row));
  }

  /** Public detail: published only; unpublished or missing → 404. */
  async publicBySlug(slug: string) {
    const row = await this.prisma.caseStudy.findUnique({
      where: { slug },
    });
    if (!row || !row.isPublished) {
      throw new NotFoundException('Case study not found');
    }
    return this.toStudyWire(row);
  }

  async list(query: { page?: string; limit?: string; q?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where: any = {};
    const q = (query.q ?? '').trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { client: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.caseStudy.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { slug: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.caseStudy.count({ where }),
    ]);

    return {
      data: data.map((row: any) => this.toStudyWire(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getById(id: string) {
    const row = await this.prisma.caseStudy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Case study not found');
    return this.toStudyWire(row);
  }

  async create(dto: CreateCaseStudyDto, actorId?: string) {
    // Media: new fields win; a legacy-only DTO derives them; the
    // legacy columns are dual-written from the resolved media (§4.3).
    const media = resolveMediaWrite(dto);
    const legacy = deriveLegacyMedia(media);
    try {
      const row = await this.prisma.caseStudy.create({
        data: {
          title: dto.title,
          slug: dto.slug,
          client: dto.client,
          businessType: dto.businessType,
          problem: dto.problem,
          solution: dto.solution,
          outcome: dto.outcome,
          metrics: (dto.metrics ?? []) as any,
          ...media,
          // Json columns: the gallery objects carry optional props,
          // which Prisma's InputJsonValue rejects — same `as any`
          // cast as metrics above (the values are already validated).
          videos: media.videos as any,
          galleryImages: media.galleryImages as any,
          featuredImageUrl: legacy.featuredImageUrl,
          videoUrl: legacy.videoUrl,
          websiteUrl: dto.websiteUrl || null,
          seoTitle: dto.seoTitle || null,
          seoDescription: dto.seoDescription || null,
          isPublished: dto.isPublished ?? false,
        },
      });
      await this.audit.record({
        actorId,
        action: 'case-study.create',
        entity: 'CaseStudy',
        entityId: row.id,
        after: { slug: row.slug, title: row.title, isPublished: row.isPublished },
      });
      return this.toStudyWire(row);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          `A case study with the slug "${dto.slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCaseStudyDto, actorId?: string) {
    const row = await this.prisma.caseStudy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Case study not found');
    // Empty-string URL/SEO fields clear the value; undefined leaves it.
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.client !== undefined) data.client = dto.client;
    if (dto.businessType !== undefined) data.businessType = dto.businessType;
    if (dto.problem !== undefined) data.problem = dto.problem;
    if (dto.solution !== undefined) data.solution = dto.solution;
    if (dto.outcome !== undefined) data.outcome = dto.outcome;
    if (dto.metrics !== undefined) data.metrics = dto.metrics;
    if (hasMediaInput(dto)) {
      // Media + legacy columns move together, normalized against the
      // stored row (video→image rescue, grandfathering — §6.3).
      const media = resolveMediaWrite(dto, previousMediaOf(row));
      const legacy = deriveLegacyMedia(media);
      Object.assign(data, media, {
        featuredImageUrl: legacy.featuredImageUrl,
        videoUrl: legacy.videoUrl,
      });
    }
    if (dto.websiteUrl !== undefined)
      data.websiteUrl = dto.websiteUrl || null;
    if (dto.seoTitle !== undefined) data.seoTitle = dto.seoTitle || null;
    if (dto.seoDescription !== undefined)
      data.seoDescription = dto.seoDescription || null;
    if (dto.isPublished !== undefined) data.isPublished = dto.isPublished;
    try {
      const updated = await this.prisma.caseStudy.update({
        where: { id },
        data: data as any,
      });
      await this.audit.record({
        actorId,
        action: 'case-study.update',
        entity: 'CaseStudy',
        entityId: id,
        before: {
          slug: row.slug,
          title: row.title,
          isPublished: row.isPublished,
        },
        after: {
          slug: updated.slug,
          title: updated.title,
          isPublished: updated.isPublished,
        },
      });
      return this.toStudyWire(updated);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          `A case study with the slug "${dto.slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async delete(id: string, actorId?: string) {
    const row = await this.prisma.caseStudy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Case study not found');
    await this.prisma.caseStudy.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'case-study.delete',
      entity: 'CaseStudy',
      entityId: id,
      before: { slug: row.slug, title: row.title },
    });
    return { deleted: true };
  }
}
