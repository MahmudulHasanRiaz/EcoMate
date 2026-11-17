import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CaptchaService } from '../signup/captcha.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { classifyContact } from './lead-contact';

const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60_000;

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

    const lead = await this.prisma.lead.create({
      data: {
        name,
        contact,
        contactType,
        message,
        monthlyOrders,
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

  async list(query: {
    page?: string;
    limit?: string;
    status?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = {};
    if (
      query.status &&
      ['NEW', 'CONTACTED', 'CLOSED'].includes(query.status)
    ) {
      where.status = query.status;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
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

  async detail(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
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
}
