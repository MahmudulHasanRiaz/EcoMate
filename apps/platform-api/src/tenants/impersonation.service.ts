import { randomBytes, createHash } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ttlSeconds(): number {
  const raw = Number(process.env.IMPERSONATION_TTL_SECONDS);
  return Number.isFinite(raw) && raw >= 60 && raw <= 3_600 ? raw : 900;
}

/**
 * One-time platform → tenant impersonation.
 *
 * The platform issues an opaque 64-char token, stores only its SHA-256, and
 * returns a tenant-host URL. The tenant backend exchanges it server-to-server
 * with the platform, which atomically revokes it, then mints a short tenant
 * access token for the owner. Raw tokens are never logged or stored.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, platformUserId?: string) {
    if (!platformUserId) {
      throw new UnauthorizedException('Platform actor is required');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'DELETED') {
      throw new BadRequestException(
        'Cannot impersonate a deleted tenant; restore it first',
      );
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ttlSeconds() * 1_000);
    await this.prisma.impersonationSession.create({
      data: {
        platformUserId,
        tenantId,
        tokenJti: sha256(rawToken),
        expiresAt,
      },
    });

    const base = this.domainConfig.absoluteUrl(
      tenant.slug,
      '/api/auth/impersonate',
    );
    const url = `${base}?token=${rawToken}`;

    await this.audit.record({
      actorId: platformUserId,
      tenantId,
      action: 'tenant.impersonate.create',
      entity: 'Tenant',
      entityId: tenantId,
      after: { expiresAt: expiresAt.toISOString() },
    });
    this.logger.log(`Impersonation token issued for ${tenant.slug}`);

    return { url, expiresAt, expiresInSeconds: ttlSeconds() };
  }

  async consume(rawToken: string, tenantId: string) {
    const token = String(rawToken || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      throw new UnauthorizedException('Invalid impersonation token');
    }

    const session = await this.prisma.impersonationSession.findUnique({
      where: { tokenJti: sha256(token.toLowerCase()) },
      include: {
        tenant: { select: { id: true, slug: true, status: true, ownerEmail: true } },
      },
    });
    if (
      !session ||
      session.tenantId !== tenantId ||
      session.tenant.status === 'DELETED' ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired impersonation token');
    }

    const claimed = await this.prisma.impersonationSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException('Impersonation token was already used');
    }

    await this.audit.record({
      actorId: session.platformUserId,
      tenantId,
      action: 'tenant.impersonate.consume',
      entity: 'Tenant',
      entityId: tenantId,
    });

    return {
      tenantId: session.tenant.id,
      slug: session.tenant.slug,
      email: session.tenant.ownerEmail,
    };
  }
}
