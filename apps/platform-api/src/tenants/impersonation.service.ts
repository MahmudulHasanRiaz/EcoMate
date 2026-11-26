import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CentralAuthClient } from '../auth/central-auth.client';
import { PlatformPrismaService } from '../prisma/prisma.service';

function ttlSeconds(): number {
  const raw = Number(process.env.IMPERSONATION_TTL_SECONDS);
  return Number.isFinite(raw) && raw >= 60 && raw <= 3_600 ? raw : 900;
}

/**
 * One-time platform → tenant impersonation (Phase 4, D8=B — BA-native
 * handoff).
 *
 * `create()` calls the central auth service's
 * `POST /internal/impersonation/issue` with the internal secret and the
 * operator's BA session headers forwarded verbatim from the console
 * request (Cookie + Host + Origin), body `{ organizationId }`. The
 * service verifies the session, checks `platformRole` ∈
 * {SUPERADMIN, SUPPORT}, resolves the tenant owner, and returns
 * `{ url, expiresAt, expiresInSeconds: 900 }` — the same public shape
 * the console button reads, so the button needs no change. Only the
 * URL's path changes (from `/api/auth/impersonate?token=…` to
 * `/api/better-auth/impersonation/consume?token=…`, slug host, never a
 * custom domain). The service's 401/403/409/429 are forwarded as-is
 * (never translated into a generic 500).
 *
 * The old bridge is RETIRED in this PR: `consume()` and
 * `POST /internal/impersonations/consume` are deleted, and no
 * `ImpersonationSession` row is written anymore. The TABLE itself is
 * kept until Phase 5 (rows are single-use ≤900 s TTL; the drop is a
 * separate, clearly-marked migration) — and the tenant export/purge
 * include keeps working against it. KNOWN BREAK (recorded, task-ordered):
 * the backend's `GET /api/auth/impersonate` still calls the deleted
 * consume route (backend auth.service.ts:920) — the old bridge stops
 * working in BOTH modes until the backend companion deletion lands in
 * the same push. In central-ba mode it was already non-functional (the
 * legacy tenant JWT it minted is ignored by the central guard); the
 * rollback to `custom-jwt` restores the legacy login but NOT legacy
 * impersonation.
 *
 * Identifier change (R-11): the old consume payload returned
 * `actorEmail` (operator email); the new session carries
 * `session.impersonatedBy` = the operator's CENTRAL user id. Anything
 * rendering the actor must resolve the id to an email, never assume
 * the string is an email.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly centralAuth: CentralAuthClient,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, platformUserId?: string, req?: any) {
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

    const issued = await this.centralAuth.issueImpersonation(tenantId, {
      cookie: req?.headers?.cookie,
      host: req?.headers?.host,
      origin: req?.headers?.origin,
    });
    const expiresAt = new Date(issued.expiresAt);

    await this.audit.record({
      actorId: platformUserId,
      tenantId,
      action: 'tenant.impersonate.create',
      entity: 'Tenant',
      entityId: tenantId,
      after: { expiresAt: expiresAt.toISOString() },
    });
    this.logger.log(`Impersonation handoff issued for ${tenant.slug}`);

    return {
      url: issued.url,
      expiresAt,
      expiresInSeconds: issued.expiresInSeconds ?? ttlSeconds(),
    };
  }
}
