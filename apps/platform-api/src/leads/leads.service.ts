import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { csvCell } from '../audit/audit-query.service';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CaptchaService } from '../signup/captcha.service';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { classifyContact } from './lead-contact';

const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60_000;

/** CSV export cap (same as the reference panel's 10,000-row cap). */
export const LEAD_EXPORT_MAX_ROWS = 10_000;

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'WON',
  'LOST',
  'CLOSED',
] as const;

export interface LeadRequestMeta {
  ip?: string;
  userAgent?: string;
}

export function leadNotificationEmail(): string {
  return process.env.PLATFORM_LEAD_EMAIL || 'sales@ecomate.bd';
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly captcha: CaptchaService,
    private readonly rateLimit: RedisRateLimitService,
    private readonly mail: PlatformMailService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateLeadDto, meta: LeadRequestMeta = {}) {
    const ipKey = meta.ip || 'unknown';
    await this.rateLimit.assert(
      `lead:ip:${ipKey}`,
      IP_LIMIT,
      IP_WINDOW_MS,
      'Too many lead submissions from this address. Please try again later.',
    );

    // Turnstile is verify-IF-present for leads — deliberately different
    // from signup, which fails closed. A lead is a low-privilege record
    // (no account, no provisioning) and the form must work on staging
    // without Turnstile keys; the per-IP rate limit is the abuse control.
    // A token that IS provided is verified when a secret is configured,
    // and a failed verification rejects the submit (a forged token is
    // worse than no token).
    if (dto.turnstileToken && this.captcha.isConfigured()) {
      const result = await this.captcha.verify(dto.turnstileToken, meta.ip);
      if (!result.ok) {
        throw new BadRequestException(
          'Human verification failed. Please complete the challenge and try again.',
        );
      }
    }

    const name = dto.name.trim();
    if (name.length < 2 || name.length > 100) {
      throw new BadRequestException('Name must be 2–100 characters');
    }
    const contact = dto.contact.trim();
    const contactType = classifyContact(contact);
    if (!contactType) {
      throw new BadRequestException(
        'Contact must be a valid email address or phone number',
      );
    }
    const message = dto.message?.trim() ? dto.message.trim() : null;
    const monthlyOrders = dto.monthlyOrders?.trim()
      ? dto.monthlyOrders.trim()
      : null;
    const consentText = dto.consentText?.trim()
      ? dto.consentText.trim()
      : null;
    const utmSource = dto.utmSource?.trim() ? dto.utmSource.trim() : null;
    const utmCampaign = dto.utmCampaign?.trim()
      ? dto.utmCampaign.trim()
      : null;

    const lead = await this.prisma.lead.create({
      data: {
        name,
        contact,
        contactType,
        message,
        monthlyOrders,
        consentGiven: dto.consentGiven ?? false,
        consentText,
        utmSource,
        utmCampaign,
        ip: meta.ip || null,
        userAgent: meta.userAgent || null,
      },
    });

    // Notify sales — best effort only. A lead submit must NEVER fail
    // because mail is down or unconfigured: the row is already persisted
    // and the console lists it regardless.
    if (this.mail.isConfigured()) {
      try {
        await this.mail.sendLeadNotification({
          to: leadNotificationEmail(),
          name,
          contact,
          contactType,
          message,
          monthlyOrders,
        });
      } catch (err) {
        this.logger.warn(
          `Lead notification failed for lead ${lead.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { id: lead.id };
  }

  private buildWhere(query: { status?: string; search?: string }) {
    const where: any = {};
    if (query.status && (LEAD_STATUSES as readonly string[]).includes(query.status)) {
      where.status = query.status;
    }
    // Substring search across the triage fields (name/contact/message),
    // case-insensitive. ILIKE scan, like the global search — pg_trgm is
    // the noted follow-up if lead volume ever makes this slow.
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contact: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async list(query: {
    page?: string;
    limit?: string;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = this.buildWhere(query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        // The console opens the detail modal from the list row, so the
        // list must carry the converted tenant too (else the modal's
        // "Converted to tenant" link never renders).
        include: {
          convertedTenant: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.lead.count({ where }),
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

  /**
   * CSV export rows (Batch 1, item 9): same filters as list(), newest
   * first, capped at LEAD_EXPORT_MAX_ROWS. `truncated` tells the caller
   * the cap bit. The controller audits the export.
   */
  async exportRows(query: { status?: string; search?: string }) {
    const where = this.buildWhere(query);
    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: LEAD_EXPORT_MAX_ROWS + 1,
    });
    const truncated = rows.length > LEAD_EXPORT_MAX_ROWS;
    return { rows: rows.slice(0, LEAD_EXPORT_MAX_ROWS), truncated };
  }

  toCsv(rows: any[]): string {
    const header = [
      'id',
      'createdAt',
      'name',
      'contact',
      'contactType',
      'monthlyOrders',
      'message',
      'status',
      'source',
      'utmSource',
      'utmCampaign',
      'consentGiven',
      'convertedTenantId',
    ];
    const lines = rows.map((row) =>
      [
        row.id,
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : row.createdAt,
        row.name,
        row.contact,
        row.contactType,
        row.monthlyOrders,
        row.message,
        row.status,
        row.source,
        row.utmSource,
        row.utmCampaign,
        row.consentGiven,
        row.convertedTenantId,
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  async detail(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        convertedTenant: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async updateStatus(
    id: string,
    dto: UpdateLeadStatusDto,
    actorId?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    const updated = await this.prisma.lead.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.audit.record({
      actorId,
      action: 'lead.status.update',
      entity: 'Lead',
      entityId: id,
      before: { status: lead.status },
      after: { status: updated.status },
    });
    return updated;
  }

  /**
   * Convert-lead-to-tenant (C1). The console creates the tenant first
   * (prefilled tenant-create form — the lead has no slug, plan or owner
   * password, so the operator supplies them), then calls this to link
   * the lead to its tenant. The link + WON status are one audited step;
   * a lead converts at most once (409 on a second convert).
   */
  async convert(id: string, dto: ConvertLeadDto, actorId?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.convertedTenantId) {
      throw new ConflictException(
        'This lead was already converted to a tenant',
      );
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const updated = await this.prisma.lead.update({
      where: { id },
      data: { convertedTenantId: tenant.id, status: 'WON' },
      include: {
        convertedTenant: { select: { id: true, name: true, slug: true } },
      },
    });
    await this.audit.record({
      actorId,
      action: 'lead.converted',
      entity: 'Lead',
      entityId: id,
      tenantId: tenant.id,
      before: { status: lead.status, convertedTenantId: null },
      after: { status: 'WON', convertedTenantId: tenant.id },
    });
    return updated;
  }
}
