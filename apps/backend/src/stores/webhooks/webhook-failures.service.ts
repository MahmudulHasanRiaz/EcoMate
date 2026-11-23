/**
 * Webhook failure lifecycle — Phase 9 webhook fix (G-12, G-16; J-05, J-11).
 *
 * `StoreWebhookFailure` is the operator-visible record of every failed
 * webhook delivery: signature failures, unknown stores, missing delivery
 * ids, enqueue failures, ingest failures. Rows are upserted by
 * `deliveryKey` where available, else by (store, reason, day bucket).
 *
 * Privacy (J-11): `payload` is a SANITIZED allowlist only — see
 * `sanitizeFailurePayload`. Secrets, headers, raw bodies, and customer
 * PII (names, phones, emails, addresses) structurally cannot land here.
 *
 * Replay: a replayable failure (ENQUEUE_FAILED / INGEST_FAILED with a
 * known external order id) re-enqueues an ingest-queue job with a
 * distinct retry job id (`webhook-retry:<deliveryKey>`). The processor
 * re-fetches the order through the bounded reconcile path and resolves
 * the row only when the order mapping exists afterwards — resolution is
 * verified, never assumed. This service is the ingest-retry path for
 * webhook failures (the equivalent of extending SyncRetryService, which
 * stays product-family only).
 */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { WEBHOOK_PRIORITY } from '../sync/webhook-priority';
import { normalizeOrder } from '../orders/normalize-order';

/** Failure reasons (plain String on the row — new reasons need no migration). */
export const WEBHOOK_FAILURE_REASONS = [
  'SIGNATURE_MISMATCH',
  'NO_SECRET',
  'UNKNOWN_STORE',
  'MISSING_DELIVERY_ID',
  'ENQUEUE_FAILED',
  'INGEST_FAILED',
  'AUTO_SYNC_DISABLED',
  // G-08/G-09 scope reason (workstream C — recorded via webhook-failure-recorder).
  'ORDER_SYNC_SCOPE_DISABLED',
] as const;

export type WebhookFailureReason = (typeof WEBHOOK_FAILURE_REASONS)[number];

/** Only failures where a verified order payload once existed are replayable. */
export const REPLAYABLE_FAILURE_REASONS: readonly string[] = ['ENQUEUE_FAILED', 'INGEST_FAILED'];

/** Distinct retry job identity (jannat J-05: `buildRetryJobId`). */
export function buildReplayJobId(deliveryKeyOrId: string): string {
  return `webhook-retry:${deliveryKeyOrId}`;
}

export interface FailurePayloadInput {
  storeId?: string | null;
  deliveryKey?: string | null;
  topic?: string | null;
  reason: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Sanitized failure payload (J-11 allowlist): order identity + totals
 * only, derived through the normalizer so unknown keys, credentials,
 * secrets, meta blobs, and customer PII structurally cannot flow in.
 * Returns null when the input is not an order-shaped object.
 */
export function sanitizeFailurePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const n = normalizeOrder(raw as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  if (n.externalId && n.externalId !== 'unknown') out.externalOrderId = n.externalId;
  if (n.externalStatus) out.status = n.externalStatus;
  out.total = n.externalTotal;
  if (n.currency) out.currency = n.currency;
  out.itemCount = n.items.length;
  return out;
}

function startOfTodayUtc(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class WebhookFailuresService {
  private readonly logger = new Logger(WebhookFailuresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
  ) {}

  /**
   * Record a failure (upsert). Delivery-keyed rows bump `occurrences`
   * and RE-OPEN a resolved/ignored row — a new failure for the same
   * delivery means the earlier resolution did not hold. Keyless rows
   * bucket by (store, reason, UTC day).
   *
   * Throws on DB errors — intake/processor call sites use
   * `recordFailureSafe` instead so a failure-row write can never break
   * the request or the job it reports on.
   */
  async recordFailure(input: FailurePayloadInput): Promise<unknown> {
    if (input.deliveryKey) return this.recordByDeliveryKey(input);
    return this.recordByDayBucket(input);
  }

  /** Never-throwing wrapper for intake/processor call sites (G-16). */
  async recordFailureSafe(input: FailurePayloadInput): Promise<unknown | null> {
    try {
      return await this.recordFailure(input);
    } catch (err) {
      this.logger.error(
        `webhook failure row lost (reason=${input.reason} store=${input.storeId ?? 'unknown'}): ${err}`,
      );
      return null;
    }
  }

  /** Paginated failure list for one store, newest first. */
  async listFailures(
    storeId: string,
    opts: { page?: number; limit?: number; status?: string } = {},
  ): Promise<{
    data: unknown[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(opts.limit) || 20)));
    const status = ['OPEN', 'RESOLVED', 'IGNORED'].includes(opts.status ?? '')
      ? (opts.status as 'OPEN' | 'RESOLVED' | 'IGNORED')
      : undefined;
    const where: Record<string, unknown> = { storeId, ...(status ? { status } : {}) };
    const [total, data] = await Promise.all([
      this.prisma.storeWebhookFailure.count({ where: where as any }),
      this.prisma.storeWebhookFailure.findMany({
        where: where as any,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: data as unknown[],
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * Manual replay (G-12): re-enqueues the ingest job with a distinct
   * retry job id. The row stays OPEN until the processor verifies the
   * order exists and resolves it (see `resolveReplay`) — enqueueing is
   * not success. Throws 404 (unknown row / wrong store), 409 (not OPEN,
   * not replayable, or no external order id to re-fetch), 503 (the
   * ingest job could not be enqueued — never a false success).
   */
  async replay(
    failureId: string,
    storeId: string,
    actorId?: string,
  ): Promise<{ replayed: boolean; runId: string; jobId: string }> {
    const row: any = await this.prisma.storeWebhookFailure.findUnique({
      where: { id: failureId },
    });
    if (!row || row.storeId !== storeId) {
      throw new NotFoundException('Webhook failure not found');
    }
    if (row.status !== 'OPEN') {
      throw new ConflictException(`Webhook failure is ${row.status}`);
    }
    if (!REPLAYABLE_FAILURE_REASONS.includes(row.reason as string)) {
      throw new ConflictException(`Cannot replay a ${row.reason} failure`);
    }
    const externalOrderId = (row.payload as Record<string, unknown> | null)?.externalOrderId;
    if (typeof externalOrderId !== 'string' || !externalOrderId) {
      throw new ConflictException('Failure has no external order id to re-fetch');
    }
    // Reconcile window: cover the day the delivery first arrived, plus
    // one — clamped to the reconcile hard max (30 days). Older orders
    // cannot be re-fetched this way; the row stays OPEN and the operator
    // sees it.
    const ageDays = Math.floor((Date.now() - new Date(row.firstSeenAt).getTime()) / 86400000);
    const replayWindowDays = Math.min(30, Math.max(1, ageDays + 1));

    const run = await this.runs.begin({
      scope: 'ORDER_INGEST' as any,
      triggerType: 'RETRY',
      storeId,
      initiatedById: actorId,
    });
    const runId = (run as any).id as string;
    const jobId = buildReplayJobId(row.deliveryKey ?? row.id);
    let enqueued: unknown;
    try {
      enqueued = await this.queues.enqueueOrThrow(
        'store-order-ingest',
        'webhook-order-retry',
        {
          runId,
          storeId,
          ...(row.deliveryKey ? { deliveryKey: row.deliveryKey } : {}),
          replayFailureId: row.id,
          externalOrderId,
          replayWindowDays,
        },
        jobId,
        // G-14: a manual replay jumps the queue (priority 1, ahead of
        // live webhooks at 5 and reconciliation at 10).
        { priority: WEBHOOK_PRIORITY['manual-retry'] },
      );
    } catch (err) {
      // G-11: a replay whose job never queued must not strand its run
      // or claim success.
      await this.runs
        .finish(runId, { created: 0, updated: 0, failed: 1 })
        .catch(() => undefined);
      this.logger.error(`webhook replay enqueue failed (failure ${failureId}): ${err}`);
      throw new ServiceUnavailableException('Ingest queue unavailable — replay not enqueued');
    }
    if (enqueued === null) {
      // Entitlement skip inside enqueueOrThrow: the tenant's plan no
      // longer includes order sync, so the replay cannot run.
      await this.runs
        .finish(runId, { created: 0, updated: 0, skipped: 1, failed: 0 })
        .catch(() => undefined);
      throw new ConflictException('Tenant plan no longer includes order sync');
    }
    return { replayed: true, runId, jobId };
  }

  /**
   * Resolve a replayed failure — only when the order mapping exists
   * (the processor calls this after the re-fetch). Returns true when
   * the row flipped to RESOLVED.
   */
  async resolveReplay(failureId: string, storeId: string, externalOrderId: string): Promise<boolean> {
    const mapping = await this.prisma.storeOrderMapping.findUnique({
      where: { storeId_externalOrderId: { storeId, externalOrderId } },
    });
    if (!mapping) return false;
    const res = await this.prisma.storeWebhookFailure.updateMany({
      where: { id: failureId, status: 'OPEN' as any },
      data: { status: 'RESOLVED' as any, resolvedAt: new Date() },
    });
    return res.count > 0;
  }

  /**
   * Resolve any OPEN row for a delivery whose ingest eventually
   * succeeded (BullMQ retry). Returns the number of rows resolved.
   */
  async resolveByDeliveryKey(deliveryKey: string): Promise<number> {
    const res = await this.prisma.storeWebhookFailure.updateMany({
      where: { deliveryKey, status: 'OPEN' as any },
      data: { status: 'RESOLVED' as any, resolvedAt: new Date() },
    });
    return res.count;
  }

  /** Operator dismiss: OPEN → IGNORED. RESOLVED rows stay RESOLVED. */
  async ignore(failureId: string, storeId: string): Promise<unknown> {
    const row: any = await this.prisma.storeWebhookFailure.findUnique({
      where: { id: failureId },
    });
    if (!row || row.storeId !== storeId) {
      throw new NotFoundException('Webhook failure not found');
    }
    if (row.status !== 'OPEN') {
      throw new ConflictException(`Webhook failure is ${row.status}`);
    }
    return this.prisma.storeWebhookFailure.update({
      where: { id: failureId },
      data: { status: 'IGNORED' as any, resolvedAt: new Date() },
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private refresh(input: FailurePayloadInput): Record<string, unknown> {
    return {
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
    };
  }

  private async recordByDeliveryKey(input: FailurePayloadInput): Promise<unknown> {
    const deliveryKey = input.deliveryKey as string;
    const existing: any = await this.prisma.storeWebhookFailure.findUnique({
      where: { deliveryKey },
    });
    if (existing) {
      return this.prisma.storeWebhookFailure.update({
        where: { deliveryKey },
        data: {
          occurrences: { increment: 1 },
          status: 'OPEN' as any,
          resolvedAt: null,
          ...this.refresh(input),
        },
      });
    }
    try {
      return await this.prisma.storeWebhookFailure.create({
        data: {
          storeId: input.storeId ?? null,
          deliveryKey,
          topic: input.topic ?? null,
          reason: input.reason,
          payload: input.payload ?? undefined,
        } as any,
      });
    } catch (err: any) {
      // P2002 race net: two concurrent failures for the same delivery
      // both missed the lookup — the loser bumps instead of erroring.
      if (err?.code === 'P2002') {
        await this.prisma.storeWebhookFailure.updateMany({
          where: { deliveryKey },
          data: { occurrences: { increment: 1 }, status: 'OPEN' as any, resolvedAt: null },
        });
        return this.prisma.storeWebhookFailure.findUnique({ where: { deliveryKey } });
      }
      throw err;
    }
  }

  private async recordByDayBucket(input: FailurePayloadInput): Promise<unknown> {
    const dayStart = startOfTodayUtc();
    // NOTE: find-then-create is not atomic — two concurrent keyless
    // failures for the same (store, reason, day) can land two rows
    // instead of one. Benign (same bucket, occurrences split across two
    // rows, no order impact); the delivery-keyed path above is the one
    // that must be exact, and it is P2002-netted.
    const existing: any = await this.prisma.storeWebhookFailure.findFirst({
      where: {
        storeId: input.storeId ?? null,
        reason: input.reason,
        status: 'OPEN' as any,
        firstSeenAt: { gte: dayStart },
      } as any,
      orderBy: { firstSeenAt: 'desc' },
    });
    if (existing) {
      return this.prisma.storeWebhookFailure.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          ...this.refresh(input),
        },
      });
    }
    return this.prisma.storeWebhookFailure.create({
      data: {
        storeId: input.storeId ?? null,
        topic: input.topic ?? null,
        reason: input.reason,
        payload: input.payload ?? undefined,
      } as any,
    });
  }
}
