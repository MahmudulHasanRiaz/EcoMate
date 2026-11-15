import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { DomainsService } from './domains.service';

const MIN_POLL_MS = 10_000;

/**
 * Polls pending custom domains so verification completes without an operator
 * clicking "check" every time. DNS is checked at most once per poll window per
 * domain (lastCheckedAt gate), and each failure is isolated: one bad domain
 * cannot stop the rest of the batch.
 */
@Injectable()
export class DomainVerificationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DomainVerificationService.name);
  private readonly pollMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domains: DomainsService,
  ) {
    this.pollMs = Math.max(
      MIN_POLL_MS,
      Number(process.env.CUSTOM_DOMAIN_POLL_MS ?? 60_000),
    );
  }

  onModuleInit(): void {
    if (process.env.CUSTOM_DOMAIN_POLL_ENABLED === 'false') {
      this.logger.log('Custom-domain DNS polling disabled');
      return;
    }
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<{ checked: number; verified: number }> {
    const cutoff = new Date(Date.now() - this.pollMs);
    let pending: Array<{ id: string; tenantId: string }> = [];
    try {
      pending = await this.prisma.tenantDomain.findMany({
        where: {
          type: 'CUSTOM',
          status: { in: ['PENDING', 'FAILED'] },
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: cutoff } },
          ],
        },
        select: { id: true, tenantId: true },
        orderBy: { lastCheckedAt: 'asc' },
        take: 25,
      });
    } catch (err) {
      this.logger.warn(
        `Custom-domain poll skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { checked: 0, verified: 0 };
    }

    let verified = 0;
    for (const domain of pending) {
      try {
        const result = await this.domains.verify(domain.tenantId, domain.id);
        if (result.verified) verified++;
      } catch (err) {
        this.logger.warn(
          `Custom-domain verification failed for ${domain.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (pending.length > 0) {
      this.logger.log(
        `Custom-domain poll: ${pending.length} checked, ${verified} verified`,
      );
    }
    return { checked: pending.length, verified };
  }
}
