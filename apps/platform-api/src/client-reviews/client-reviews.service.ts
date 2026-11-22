import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { normalizeMediaFields } from '../common/media/media.dto';
import {
  previousMediaOf,
  resolveMediaWithLegacyFallback,
} from '../common/media/media.service-helpers';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  CLIENT_REVIEW_STATUSES,
  deriveEffectiveReviewFormat,
} from './client-reviews.constants';
import { CreateClientReviewDto } from './dto/create-client-review.dto';
import { UpdateClientReviewDto } from './dto/update-client-review.dto';

/**
 * Client reviews (Landing CMS — shared media model): operator CRUD +
 * the public published-only list the landing home page renders
 * (video slider + text grid). Role gating lives on the controller
 * (reads READ_ROLES, writes SUPERADMIN/BILLING — same as
 * blog/case-studies, since edits reach the public site); every write
 * is audited. The public list NEVER returns a draft.
 *
 * No legacy media columns on this model (it is new) — so no
 * dual-write here; the shared media fields are the only media.
 */
@Injectable()
export class ClientReviewsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Wire shape: resolved media + the derived effectiveFormat (§3.1). */
  private toReviewWire(row: any) {
    const media = resolveMediaWithLegacyFallback(row);
    return {
      ...row,
      ...media,
      effectiveFormat: deriveEffectiveReviewFormat(row.format, media),
    };
  }

  /** Public list for the landing: published only, featured first. */
  async publicList() {
    const rows = await this.prisma.clientReview.findMany({
      where: { status: 'published' },
      orderBy: [
        { isFeatured: 'desc' },
        { sortOrder: 'asc' },
        { createdAt: 'desc' },
      ],
    });
    return rows.map((row: any) => this.toReviewWire(row));
  }

  async list(query: {
    page?: string;
    limit?: string;
    q?: string;
    status?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where: any = {};
    if (
      query.status &&
      (CLIENT_REVIEW_STATUSES as readonly string[]).includes(query.status)
    ) {
      where.status = query.status;
    }
    const q = (query.q ?? '').trim();
    if (q) {
      where.OR = [
        { reviewerName: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { role: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientReview.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.clientReview.count({ where }),
    ]);

    return {
      data: data.map((row: any) => this.toReviewWire(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getById(id: string) {
    const row = await this.prisma.clientReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Client review not found');
    return this.toReviewWire(row);
  }

  private async assertCaseStudyExists(caseStudyId: string) {
    const study = await this.prisma.caseStudy.findUnique({
      where: { id: caseStudyId },
      select: { id: true },
    });
    if (!study) {
      throw new BadRequestException('Case study not found');
    }
  }

  async create(dto: CreateClientReviewDto, actorId?: string) {
    if (dto.caseStudyId) await this.assertCaseStudyExists(dto.caseStudyId);
    const media = normalizeMediaFields(dto);
    const row = await this.prisma.clientReview.create({
      data: {
        reviewerName: dto.reviewerName,
        role: dto.role ?? '',
        companyName: dto.companyName,
        category: dto.category ?? '',
        location: dto.location ?? '',
        quoteEn: dto.quoteEn,
        quoteBn: dto.quoteBn ?? '',
        websiteUrl: dto.websiteUrl || null,
        logoUrl: dto.logoUrl || null,
        rating: dto.rating ?? null,
        metrics: (dto.metrics ?? []) as any,
        format: dto.format ?? 'text',
        videoProvider: dto.videoProvider ?? 'youtube',
        videoDuration: dto.videoDuration ?? '',
        caseStudyId: dto.caseStudyId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isFeatured: dto.isFeatured ?? false,
        status: dto.status ?? 'draft',
        ...media,
        // Json columns: the gallery objects carry optional props,
        // which Prisma's InputJsonValue rejects — same `as any` cast
        // as metrics (the values are already validated).
        videos: media.videos as any,
        galleryImages: media.galleryImages as any,
      },
    });
    await this.audit.record({
      actorId,
      action: 'client-review.create',
      entity: 'ClientReview',
      entityId: row.id,
      after: {
        reviewerName: row.reviewerName,
        companyName: row.companyName,
        status: row.status,
      },
    });
    return this.toReviewWire(row);
  }

  async update(id: string, dto: UpdateClientReviewDto, actorId?: string) {
    const row = await this.prisma.clientReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Client review not found');
    if (dto.caseStudyId) await this.assertCaseStudyExists(dto.caseStudyId);
    // Empty-string URL fields clear the value; undefined leaves it.
    const data: Record<string, unknown> = {};
    if (dto.reviewerName !== undefined) data.reviewerName = dto.reviewerName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.companyName !== undefined) data.companyName = dto.companyName;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.quoteEn !== undefined) data.quoteEn = dto.quoteEn;
    if (dto.quoteBn !== undefined) data.quoteBn = dto.quoteBn;
    if (dto.websiteUrl !== undefined)
      data.websiteUrl = dto.websiteUrl || null;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl || null;
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.metrics !== undefined) data.metrics = dto.metrics;
    if (dto.format !== undefined) data.format = dto.format;
    if (dto.videoProvider !== undefined)
      data.videoProvider = dto.videoProvider;
    if (dto.videoDuration !== undefined)
      data.videoDuration = dto.videoDuration;
    if (dto.caseStudyId !== undefined) data.caseStudyId = dto.caseStudyId;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isFeatured !== undefined) data.isFeatured = dto.isFeatured;
    if (dto.status !== undefined) data.status = dto.status;
    // Media: normalize against the stored row (video→image rescue,
    // grandfathering) whenever any media field is present.
    const hasMedia =
      dto.thumbnailType !== undefined ||
      dto.thumbnailUrl !== undefined ||
      dto.thumbnailVideoUrl !== undefined ||
      dto.thumbnailAutoplay !== undefined ||
      dto.videos !== undefined ||
      dto.galleryImages !== undefined;
    if (hasMedia) {
      Object.assign(
        data,
        normalizeMediaFields(dto, previousMediaOf(row)),
      );
    }
    const updated = await this.prisma.clientReview.update({
      where: { id },
      data: data as any,
    });
    await this.audit.record({
      actorId,
      action: 'client-review.update',
      entity: 'ClientReview',
      entityId: id,
      before: {
        reviewerName: row.reviewerName,
        companyName: row.companyName,
        status: row.status,
      },
      after: {
        reviewerName: updated.reviewerName,
        companyName: updated.companyName,
        status: updated.status,
      },
    });
    return this.toReviewWire(updated);
  }

  async delete(id: string, actorId?: string) {
    const row = await this.prisma.clientReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Client review not found');
    await this.prisma.clientReview.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'client-review.delete',
      entity: 'ClientReview',
      entityId: id,
      before: {
        reviewerName: row.reviewerName,
        companyName: row.companyName,
      },
    });
    return { deleted: true };
  }
}
