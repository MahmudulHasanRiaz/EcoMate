import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';

export interface AuditRecordInput {
  actorId?: string | null;
  tenantId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PlatformPrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: 'PLATFORM',
          actorId: input.actorId ?? null,
          tenantId: input.tenantId ?? null,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          before: (input.before ?? undefined) as any,
          after: (input.after ?? undefined) as any,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      // Auditing must never hide the primary operation's result. The error is
      // logged for the platform operator; the mutation itself already succeeded.
      this.logger.error(
        `Failed to write audit log ${input.action} ${input.entity}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
