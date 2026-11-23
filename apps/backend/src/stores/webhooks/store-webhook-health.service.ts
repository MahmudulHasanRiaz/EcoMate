/**
 * Webhook health summary + failure-rate alerting (Phase 9 P2, J-12).
 *
 * `GET /stores/:id/webhooks/health` answers, from STORED data only (no
 * live provider call — the endpoint must stay fast and must not fail
 * when Woo is down):
 *  - delivery counts (last hour / 24h) + last verified delivery,
 *  - ingest outcomes over the last hour + the ingest failure rate,
 *  - open webhook/ingest issues,
 *  - a hook-status heuristic (see below).
 *
 * Failure-rate alerting: when the ingest failure rate over the last
 * hour exceeds `STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD` (default
 * 10%) with at least `STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME` (default
 * 10) ingest items in the window, `evaluateAndAlert` writes a
 * structured warning log + upserts ONE `WEBHOOK_FAILURE_RATE_HIGH`
 * issue row (compact-state rule: repeats update the same row). The
 * health endpoint calls it fire-and-forget on every read; Builder A's
 * webhook-health scheduler should call it per store on its hourly
 * tick too (it is exported from StoresModule for that). No new
 * external alerting infra — the issue row is the console-visible
 * alert, and the existing repeated-failure email (SyncNotifyService)
 * fires from the issue's occurrence count.
 *
 * Hook status is a HEURISTIC until Builder A's health scheduler lands
 * (it will poll `GET /webhooks` per store and record issues):
 *  - `attention` — an open webhook-related issue exists;
 *  - `active` — a verified delivery arrived in the last 24h and no
 *    open webhook issue exists;
 *  - `unknown` — otherwise (no recent delivery, no issue — e.g. a
 *    quiet store, or a store whose webhook was never created).
 * It deliberately never claims `disabled`: only a live provider poll
 * can know that.
 *
 * Coverage note: delivery rows only exist for deliveries that PASSED
 * intake verification, so the delivery counts measure ingest health,
 * not intake rejections. Intake failures (bad signature, unknown
 * store, missing delivery id, enqueue/ingest failures) land in
 * Builder B's `StoreWebhookFailure` table — the summary counts OPEN
 * rows from it (`intakeFailures` block) so a store whose deliveries
 * are all being rejected is visible here too. The delegate is
 * accessed defensively: a stale generated Prisma client (no
 * `storeWebhookFailure` delegate) degrades to zeros instead of
 * failing the endpoint.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunService } from '../sync/sync-run.service';

/** Issue codes that count as webhook/ingest health signals. */
const WEBHOOK_ISSUE_CODES = [
  'ORDER_INGEST_FAILED',
  'ORDER_RECONCILE_FAILED',
  'ORDER_RECONCILE_AT_LIMIT',
  'WEBHOOK_FAILURE_RATE_HIGH',
];

export const WEBHOOK_FAILURE_RATE_ISSUE_CODE = 'WEBHOOK_FAILURE_RATE_HIGH';
export const WEBHOOK_FAILURE_RATE_THRESHOLD_DEFAULT = 0.1;
export const WEBHOOK_FAILURE_RATE_MIN_VOLUME_DEFAULT = 10;

export interface WebhookFailureRateAlertConfig {
  threshold: number;
  minVolume: number;
}

export function webhookFailureRateAlertConfig(
  env: Record<string, string | undefined> = process.env,
): WebhookFailureRateAlertConfig {
  const rawThreshold = Number(env['STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD']);
  const rawMinVolume = Number(env['STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME']);
  return {
    threshold:
      Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 1
        ? rawThreshold
        : WEBHOOK_FAILURE_RATE_THRESHOLD_DEFAULT,
    minVolume:
      Number.isFinite(rawMinVolume) && rawMinVolume > 0
        ? Math.floor(rawMinVolume)
        : WEBHOOK_FAILURE_RATE_MIN_VOLUME_DEFAULT,
  };
}

export type WebhookHookStatus = 'active' | 'attention' | 'unknown';

export interface StoreWebhookHealth {
  storeId: string;
  storeName: string;
  kind: string;
  status: string;
  healthState: string;
  lastHealthCheckAt: Date | null;
  deliveries: {
    lastHour: number;
    last24h: number;
    lastSeenAt: Date | null;
    lastTopic: string | null;
  };
  ingest: {
    lastHour: {
      total: number;
      created: number;
      updated: number;
      skipped: number;
      failed: number;
      /** null when the window holds fewer than minVolume items. */
      failureRate: number | null;
    };
    lastRun: {
      id: string;
      status: string;
      startedAt: Date;
      finishedAt: Date | null;
      failedCount: number;
    } | null;
  };
  issues: {
    openCount: number;
    recent: Array<{
      code: string;
      message: string;
      occurrences: number;
      lastSeenAt: Date;
    }>;
  };
  /**
   * Intake failures from the StoreWebhookFailure table (Builder B):
   * deliveries rejected before ingest (bad signature, unknown store,
   * missing delivery id) plus enqueue/ingest failures. OPEN rows seen
   * in the last 24h — a store whose deliveries are all being rejected
   * shows 0 verified deliveries AND a nonzero count here.
   */
  intakeFailures: {
    openLast24h: number;
    lastSeenAt: Date | null;
    lastReason: string | null;
  };
  hooks: { status: WebhookHookStatus; detail: string };
  alert: {
    triggered: boolean;
    threshold: number;
    minVolume: number;
  };
}

@Injectable()
export class StoreWebhookHealthService {
  private readonly logger = new Logger(StoreWebhookHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
  ) {}

  async getHealth(storeId: string): Promise<StoreWebhookHealth> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) {
      throw new NotFoundException(`Store ${storeId} not found`);
    }
    const s = store as any;
    const now = Date.now();
    const oneHourAgo = new Date(now - 3600_000);
    const oneDayAgo = new Date(now - 24 * 3600_000);

    const [deliveriesLastHour, deliveriesLast24h, lastDelivery, runsLastHour, lastRun, openIssues, intakeFailures24h, lastIntakeFailure] =
      await Promise.all([
        this.prisma.storeWebhookDelivery.count({
          where: { storeId, firstSeenAt: { gte: oneHourAgo } },
        }),
        this.prisma.storeWebhookDelivery.count({
          where: { storeId, firstSeenAt: { gte: oneDayAgo } },
        }),
        this.prisma.storeWebhookDelivery.findFirst({
          where: { storeId },
          orderBy: { firstSeenAt: 'desc' },
          select: { firstSeenAt: true, topic: true },
        }),
        this.prisma.syncRun.findMany({
          where: {
            storeId,
            scope: 'ORDER_INGEST' as any,
            startedAt: { gte: oneHourAgo },
          },
          select: {
            createdCount: true,
            updatedCount: true,
            skippedCount: true,
            failedCount: true,
          },
        }),
        this.prisma.syncRun.findFirst({
          where: { storeId, scope: 'ORDER_INGEST' as any },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            failedCount: true,
          },
        }),
        this.prisma.storeSyncIssue.findMany({
          where: {
            storeId,
            status: 'OPEN' as any,
            OR: [
              { code: { in: WEBHOOK_ISSUE_CODES } },
              { code: { startsWith: 'WEBHOOK' } },
            ],
          },
          orderBy: { lastSeenAt: 'desc' },
          take: 5,
          select: {
            code: true,
            message: true,
            occurrences: true,
            lastSeenAt: true,
          },
        }),
        // Intake failures (StoreWebhookFailure, Builder B) — defensive:
        // a stale generated client without the delegate degrades to
        // zeros instead of failing the whole summary.
        this.intakeFailureCount(storeId, oneDayAgo),
        this.lastIntakeFailure(storeId),
      ]);

    const ingestTotals = (runsLastHour as any[]).reduce(
      (acc, r) => ({
        created: acc.created + (r.createdCount ?? 0),
        updated: acc.updated + (r.updatedCount ?? 0),
        skipped: acc.skipped + (r.skippedCount ?? 0),
        failed: acc.failed + (r.failedCount ?? 0),
      }),
      { created: 0, updated: 0, skipped: 0, failed: 0 },
    );
    const total =
      ingestTotals.created +
      ingestTotals.updated +
      ingestTotals.skipped +
      ingestTotals.failed;
    const { threshold, minVolume } = webhookFailureRateAlertConfig();
    const failureRate = total >= minVolume ? ingestTotals.failed / total : null;
    const alertTriggered =
      failureRate !== null && failureRate >= threshold;

    const lastDeliveryAt = (lastDelivery as any)?.firstSeenAt ?? null;
    const intake = {
      openLast24h: intakeFailures24h,
      lastSeenAt: (lastIntakeFailure as any)?.lastSeenAt ?? null,
      lastReason: (lastIntakeFailure as any)?.reason ?? null,
    };
    const hooks = this.hookStatus(
      (openIssues as any[]).length > 0,
      intake.openLast24h > 0,
      lastDeliveryAt ? new Date(lastDeliveryAt).getTime() : null,
      now,
    );

    return {
      storeId,
      storeName: s.name,
      kind: String(s.kind),
      status: String(s.status),
      healthState: String(s.healthState ?? 'DISCONNECTED'),
      lastHealthCheckAt: s.lastHealthCheckAt ?? null,
      deliveries: {
        lastHour: deliveriesLastHour,
        last24h: deliveriesLast24h,
        lastSeenAt: lastDeliveryAt,
        lastTopic: (lastDelivery as any)?.topic ?? null,
      },
      ingest: {
        lastHour: {
          total,
          ...ingestTotals,
          failureRate,
        },
        lastRun: lastRun
          ? {
              id: (lastRun as any).id,
              status: String((lastRun as any).status),
              startedAt: (lastRun as any).startedAt,
              finishedAt: (lastRun as any).finishedAt ?? null,
              failedCount: (lastRun as any).failedCount ?? 0,
            }
          : null,
      },
      issues: {
        openCount: (openIssues as any[]).length,
        recent: (openIssues as any[]).map((i) => ({
          code: i.code,
          message: i.message,
          occurrences: i.occurrences,
          lastSeenAt: i.lastSeenAt,
        })),
      },
      intakeFailures: intake,
      hooks,
      alert: { triggered: alertTriggered, threshold, minVolume },
    };
  }

  /**
   * Failure-rate alert (J-12): structured log + ONE upserted issue row
   * when the health summary's rate is at/above threshold. Idempotent
   * (upsert by store+code+objectKey). Never throws — alerting must not
   * fail the caller (the health endpoint calls this fire-and-forget).
   */
  async evaluateAndAlert(
    storeId: string,
    health: StoreWebhookHealth,
  ): Promise<{ alerted: boolean }> {
    try {
      if (!health.alert.triggered || health.ingest.lastHour.failureRate === null) {
        return { alerted: false };
      }
      const rate = health.ingest.lastHour.failureRate;
      const { failed, total } = health.ingest.lastHour;
      this.logger.warn(
        `webhook failure rate high: store=${storeId} ` +
          `rate=${rate.toFixed(3)} failed=${failed} total=${total} ` +
          `window=1h threshold=${health.alert.threshold}`,
      );
      await this.runs.upsertIssue({
        storeId,
        code: WEBHOOK_FAILURE_RATE_ISSUE_CODE,
        objectType: 'ORDER',
        objectKey: `store:${storeId}:webhook:failure-rate`,
        message:
          `Webhook ingest failure rate ${(rate * 100).toFixed(1)}% over the last hour ` +
          `(${failed} failed of ${total} orders, threshold ${(health.alert.threshold * 100).toFixed(0)}%). ` +
          `Check the Sync Center issues for this store.`,
      });
      return { alerted: true };
    } catch (err) {
      this.logger.error(
        `webhook failure-rate alert failed for store ${storeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { alerted: false };
    }
  }

  /**
   * OPEN StoreWebhookFailure rows seen in the last 24h (0 when the
   * delegate is absent — stale generated client — never throws).
   */
  private async intakeFailureCount(storeId: string, since: Date): Promise<number> {
    try {
      const delegate = (this.prisma as any)?.storeWebhookFailure;
      if (!delegate?.count) return 0;
      return await delegate.count({
        where: { storeId, status: 'OPEN', lastSeenAt: { gte: since } },
      });
    } catch (err) {
      this.logger.warn(`intake failure count failed for store ${storeId}: ${err}`);
      return 0;
    }
  }

  /** Most recent OPEN intake failure, or null (never throws). */
  private async lastIntakeFailure(
    storeId: string,
  ): Promise<{ lastSeenAt: Date; reason: string } | null> {
    try {
      const delegate = (this.prisma as any)?.storeWebhookFailure;
      if (!delegate?.findFirst) return null;
      return await delegate.findFirst({
        where: { storeId, status: 'OPEN' },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true, reason: true },
      });
    } catch (err) {
      this.logger.warn(`last intake failure lookup failed for store ${storeId}: ${err}`);
      return null;
    }
  }

  private hookStatus(
    hasOpenWebhookIssue: boolean,
    hasOpenIntakeFailure: boolean,
    lastDeliveryAtMs: number | null,
    nowMs: number,
  ): { status: WebhookHookStatus; detail: string } {
    if (hasOpenWebhookIssue || hasOpenIntakeFailure) {
      return {
        status: 'attention',
        detail: hasOpenIntakeFailure
          ? 'Open webhook intake failures exist for this store — deliveries are being rejected before ingest. See the failure list.'
          : 'An open webhook/ingest issue exists for this store — see issues.',
      };
    }
    if (lastDeliveryAtMs !== null && nowMs - lastDeliveryAtMs < 24 * 3600_000) {
      return {
        status: 'active',
        detail: 'A verified webhook delivery arrived in the last 24h.',
      };
    }
    return {
      status: 'unknown',
      detail:
        'No verified delivery in the last 24h and no open issue — the store may be quiet, or no webhook may be registered (live hook status arrives with the webhook-health scheduler).',
    };
  }
}
