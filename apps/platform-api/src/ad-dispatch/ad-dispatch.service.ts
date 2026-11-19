import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AD_PLATFORMS } from './ad-platforms';
import { AdSenderRegistry } from './ad-sender.registry';
import type { AdLeadContext } from './senders/ad-sender';

/**
 * Ad dispatch queue (CMS batch 2, item 21): durable retry queue for
 * lead events to Meta Conversions API / TikTok Events API (and any
 * future platform). Triggers:
 *
 * - instant mode: enqueue on lead creation (LeadsService.create hook).
 * - validated mode: enqueue when the lead's status changes to the
 *   platform's configured trigger status (LeadsService.updateStatus
 *   hook).
 *
 * Enqueue is idempotent per (lead, platform, eventName) — a re-fire
 * (status flip-flopping through the trigger) never creates a second
 * row. An unconfigured platform (no pixel id, no token, or disabled)
 * is skipped silently, never an error: there are no real ad-account
 * credentials yet, and dispatch must stay a no-op until Boss wires
 * one. The backoff ladder allows 5 retries (6 attempts total); after
 * the 6th failed attempt the row is terminal `failed` until an
 * operator retries it from the lead drawer.
 *
 * Runner choice: a DEDICATED processor in this module, NOT the
 * billing-jobs runner. Billing jobs tick hourly (their work is
 * date-driven: trials, renewals, grace); ad dispatch needs
 * minute-level retries (first backoff is 1 minute) and is
 * marketing-side, not billing-side — folding it into the billing
 * tick would either delay retries by up to an hour or force the
 * billing tick down to a minute. The processor reuses the billing
 * runner's shape (setInterval + running guard + env gate + manual
 * run endpoint) but runs on its own cadence.
 */
export const AD_DISPATCH_BACKOFF_MS = [
  60_000, // 1m
  5 * 60_000, // 5m
  30 * 60_000, // 30m
  2 * 3_600_000, // 2h
  12 * 3_600_000, // 12h
] as const;

/**
 * Max send attempts per row: the initial send + one retry per ladder
 * step. After the 6th failed attempt the row is terminal `failed`
 * (operator retry from the drawer starts a fresh ladder).
 */
export const AD_DISPATCH_MAX_ATTEMPTS = AD_DISPATCH_BACKOFF_MS.length + 1;
export const AD_DISPATCH_BATCH_SIZE = 100;
export const AD_DISPATCH_INTERVAL_MS = 60_000;

export type AdDispatchStatus = 'pending' | 'sent' | 'failed';

/** Minimal Lead shape the dispatcher needs (the Prisma row satisfies it). */
export interface AdLead {
  id: string;
  name: string;
  contact: string;
  contactType: 'email' | 'phone';
  fbp?: string | null;
  fbc?: string | null;
  eventId?: string | null;
  ttclid?: string | null;
  tiktokEventId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

export interface AdDispatchRunResult {
  processed: number;
  sent: number;
  /** Attempts that failed this run but will retry (ladder not exhausted). */
  failed: number;
  /** Rows that exhausted the ladder this run (now terminal `failed`). */
  gaveUp: number;
  /** Rows skipped (platform unconfigured/disabled, no sender, lead gone). */
  skipped: number;
}

/**
 * Next retry time after a failed attempt. `attempts` is the count
 * AFTER this failure (1-based). Returns null when the ladder is
 * exhausted — the row becomes terminal `failed`.
 */
export function nextRetryAtAfter(
  attempts: number,
  now: Date,
): Date | null {
  const delay = AD_DISPATCH_BACKOFF_MS[attempts - 1];
  if (delay === undefined) return null;
  return new Date(now.getTime() + delay);
}

const LAST_ERROR_MAX_LENGTH = 2000;

@Injectable()
export class AdDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdDispatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly senders: AdSenderRegistry,
  ) {}

  onModuleInit() {
    if (process.env.AD_DISPATCH_ENABLED === 'false') {
      this.logger.log('Ad dispatch disabled (AD_DISPATCH_ENABLED=false)');
      return;
    }
    const interval =
      Number(process.env.AD_DISPATCH_INTERVAL_MS) || AD_DISPATCH_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tryRun().catch((error) => {
        this.logger.error(
          `Ad dispatch tick failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, interval);
    this.timer.unref?.();
    this.logger.log(`Ad dispatch scheduled every ${interval}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Instant-mode trigger (called from LeadsService.create). NEVER
   * throws: a dispatch failure must not fail a lead submit — the
   * failure is logged and the lead is unaffected (the queue row is
   * the durable part, and a missed enqueue is visible in the drawer
   * as "no dispatch" rather than a lost lead).
   */
  async onLeadCreated(lead: AdLead): Promise<void> {
    try {
      const configs = this.settings.getAdTrackingInternal();
      for (const platform of AD_PLATFORMS) {
        const config = configs[platform.id];
        if (!config || config.mode !== 'instant') continue;
        if (!this.isConfigured(config)) continue;
        await this.enqueue(lead.id, platform.id, config.eventName);
      }
    } catch (error) {
      this.logger.warn(
        `Ad dispatch enqueue failed for lead ${lead.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Validated-mode trigger (called from LeadsService.updateStatus).
   * Same never-throws contract as onLeadCreated.
   */
  async onLeadStatusChanged(lead: AdLead, status: string): Promise<void> {
    try {
      const configs = this.settings.getAdTrackingInternal();
      for (const platform of AD_PLATFORMS) {
        const config = configs[platform.id];
        if (!config || config.mode !== 'validated') continue;
        if (config.triggerStatus !== status) continue;
        if (!this.isConfigured(config)) continue;
        await this.enqueue(lead.id, platform.id, config.eventName);
      }
    } catch (error) {
      this.logger.warn(
        `Ad dispatch enqueue failed for lead ${lead.id} (status ${status}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Idempotent enqueue: one row per (lead, platform, eventName). A
   * re-fire returns the existing row (pending, sent, or failed — a
   * failed row is operator-retried from the drawer, never silently
   * re-enqueued by a trigger).
   */
  async enqueue(leadId: string, platform: string, eventName: string) {
    const existing = await this.prisma.adDispatch.findUnique({
      where: {
        leadId_platform_eventName: { leadId, platform, eventName },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.adDispatch.create({
        data: { leadId, platform, eventName, status: 'pending' },
      });
    } catch (error) {
      // Lost a race with a concurrent enqueue (unique violation) —
      // the other row is the one that counts.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        const raced = await this.prisma.adDispatch.findUnique({
          where: {
            leadId_platform_eventName: { leadId, platform, eventName },
          },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Dispatch rows for a lead (drawer), oldest first. 404s on a missing lead. */
  async listForLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return this.prisma.adDispatch.findMany({
      where: { leadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Operator retry of a terminal `failed` row: back to pending with a
   * fresh ladder. Only `failed` rows are retryable (a pending row is
   * already queued; a sent row is done). Audited.
   */
  async retry(id: string, actorId?: string) {
    const row = await this.prisma.adDispatch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispatch not found');
    if (row.status !== 'failed') {
      throw new ConflictException(
        `Only a failed dispatch can be retried (current status: ${row.status})`,
      );
    }
    const updated = await this.prisma.adDispatch.update({
      where: { id },
      data: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextRetryAt: null,
      },
    });
    await this.audit.record({
      actorId,
      action: 'ad-dispatch.retry',
      entity: 'AdDispatch',
      entityId: id,
      after: {
        leadId: row.leadId,
        platform: row.platform,
        eventName: row.eventName,
      },
    });
    return updated;
  }

  /**
   * One processor pass, guarded against overlap (tick + manual run
   * share the guard). Returns null when a run is already in progress.
   */
  async tryRun(now = new Date()): Promise<AdDispatchRunResult | null> {
    if (this.running) {
      this.logger.warn('Ad dispatch run skipped: a run is already in progress');
      return null;
    }
    this.running = true;
    try {
      return await this.processDue(now);
    } finally {
      this.running = false;
    }
  }

  /** Send every due pending row (bounded batch, oldest first). */
  async processDue(now = new Date()): Promise<AdDispatchRunResult> {
    const result: AdDispatchRunResult = {
      processed: 0,
      sent: 0,
      failed: 0,
      gaveUp: 0,
      skipped: 0,
    };
    const due = await this.prisma.adDispatch.findMany({
      where: {
        status: 'pending',
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: AD_DISPATCH_BATCH_SIZE,
    });
    for (const row of due) {
      result.processed += 1;
      const outcome = await this.attempt(row, now);
      result[outcome] += 1;
    }
    return result;
  }

  /**
   * One send attempt. Returns the outcome bucket for the run summary.
   * A row whose platform became unconfigured (or has no sender) is
   * SKIPPED, not failed: no attempt is burned, and the row stays
   * pending so it sends once the platform is configured again.
   */
  private async attempt(
    row: {
      id: string;
      leadId: string;
      platform: string;
      eventName: string;
      attempts: number;
      createdAt: Date;
    },
    now: Date,
  ): Promise<'sent' | 'failed' | 'gaveUp' | 'skipped'> {
    const config = this.settings.getAdTrackingInternal()[row.platform];
    if (!config || !this.isConfigured(config)) {
      this.logger.debug(
        `Ad dispatch ${row.id} skipped: platform ${row.platform} is not configured`,
      );
      return 'skipped';
    }
    const sender = this.senders.get(row.platform);
    if (!sender) {
      this.logger.warn(
        `Ad dispatch ${row.id} skipped: no sender for platform ${row.platform}`,
      );
      return 'skipped';
    }
    const lead = await this.prisma.lead.findUnique({
      where: { id: row.leadId },
    });
    if (!lead) {
      // The FK is Cascade, so this should not happen — but a missing
      // lead must not spin the retry ladder forever.
      this.logger.warn(
        `Ad dispatch ${row.id} skipped: lead ${row.leadId} no longer exists`,
      );
      return 'skipped';
    }
    const context: AdLeadContext = {
      platform: row.platform,
      lead: {
        id: lead.id,
        name: lead.name,
        contact: lead.contact,
        contactType: lead.contactType as 'email' | 'phone',
        fbp: lead.fbp,
        fbc: lead.fbc,
        eventId: lead.eventId,
        ttclid: lead.ttclid,
        tiktokEventId: lead.tiktokEventId,
        ip: lead.ip,
        userAgent: lead.userAgent,
        createdAt: lead.createdAt,
      },
      dispatch: {
        id: row.id,
        eventName: row.eventName,
        createdAt: row.createdAt,
      },
      config: { pixelId: config.pixelId, accessToken: config.accessToken! },
      eventSourceUrl:
        process.env.AD_DISPATCH_EVENT_SOURCE_URL?.trim() || undefined,
    };
    try {
      await sender.send(context);
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, LAST_ERROR_MAX_LENGTH);
      const attempts = row.attempts + 1;
      const nextRetryAt = nextRetryAtAfter(attempts, now);
      await this.prisma.adDispatch.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: message,
          status: nextRetryAt === null ? 'failed' : 'pending',
          nextRetryAt,
        },
      });
      this.logger.warn(
        `Ad dispatch ${row.id} (${row.platform}/${row.eventName}) attempt ${attempts} failed: ${message}`,
      );
      return nextRetryAt === null ? 'gaveUp' : 'failed';
    }
    await this.prisma.adDispatch.update({
      where: { id: row.id },
      data: {
        status: 'sent',
        attempts: row.attempts + 1,
        lastError: null,
        nextRetryAt: null,
        sentAt: now,
      },
    });
    return 'sent';
  }

  private isConfigured(config: {
    enabled: boolean;
    pixelId: string;
    accessToken?: string;
  }): boolean {
    return (
      config.enabled &&
      config.pixelId.trim().length > 0 &&
      (config.accessToken?.trim().length ?? 0) > 0
    );
  }
}
