/**
 * Visible skip records for auto-sync / sync-scope gating (G-08/G-09).
 *
 * A webhook suppressed by the store's own settings must be VISIBLE, not
 * silent: it lands in builder B's `StoreWebhookFailure` table with status
 * IGNORED and reason `AUTO_SYNC_DISABLED` / `ORDER_SYNC_SCOPE_DISABLED`
 * (shared contract). Both gating layers (intake + ingest processor) call
 * `recordWebhookSkip()` here so the row shape is defined once.
 *
 * DEPENDENCY (builder B owns the table): `StoreWebhookFailure` HAS
 * landed (`schema.prisma`, `deliveryKey @unique` — the upsert key this
 * module relies on). This module still accesses the delegate
 * defensively — `(prisma as any).storeWebhookFailure` — and no-ops with
 * a warning when the delegate is absent (e.g. a stale generated client).
 * It NEVER throws: a recorder failure must never break intake or the
 * processor — the `StoreWebhookDelivery` row (intake) / `SyncRunItem`
 * (processor) remain the primary audit.
 *
 * Upsert key: the real `deliveryKey` when available (one row per
 * delivery, `occurrences` counting repeats); otherwise a synthetic
 * day-bucket key `skip:<storeId>:<reason>:<YYYY-MM-DD>` — one row per
 * store/reason/day, matching the plan's "store+reason+day bucket" rule
 * for key-less records. The synthetic key cannot collide with a real
 * delivery key (real keys are 64-hex sha256).
 *
 * ASSUMPTION (flagged for the coordinator): B's model carries a UNIQUE
 * constraint on `deliveryKey` (the plan's "upsert by deliveryKey" only
 * works with one). If B lands the model without it, this upsert throws
 * at runtime and degrades to warn-and-continue — the coordinator must
 * reconcile the constraint, not this call site.
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('WebhookFailureRecorder');

export type WebhookSkipReason = 'AUTO_SYNC_DISABLED' | 'ORDER_SYNC_SCOPE_DISABLED';

export interface WebhookSkipInput {
  tenantId?: string | null;
  storeId: string;
  /** Real provider delivery key when the skip happens at intake. */
  deliveryKey?: string | null;
  topic?: string | null;
  reason: WebhookSkipReason;
}

/** Synthetic day-bucket key for skips without a delivery key. */
export function buildSkipDeliveryKey(storeId: string, reason: WebhookSkipReason, day?: Date): string {
  const bucket = (day ?? new Date()).toISOString().slice(0, 10);
  return `skip:${storeId}:${reason}:${bucket}`;
}

/**
 * Record (upsert) one IGNORED skip row. Returns true when a row was
 * written, false when the table is unavailable or the write failed
 * (warned, never thrown).
 */
export async function recordWebhookSkip(prisma: unknown, input: WebhookSkipInput): Promise<boolean> {
  const delegate = (prisma as any)?.storeWebhookFailure;
  if (!delegate?.upsert) {
    logger.warn(
      `webhook skip not recorded (StoreWebhookFailure unavailable): store=${input.storeId} reason=${input.reason}`,
    );
    return false;
  }
  const key = input.deliveryKey ?? buildSkipDeliveryKey(input.storeId, input.reason);
  const now = new Date();
  try {
    await delegate.upsert({
      where: { deliveryKey: key },
      create: {
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        storeId: input.storeId,
        deliveryKey: key,
        topic: input.topic ?? null,
        reason: input.reason,
        status: 'IGNORED',
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { occurrences: { increment: 1 }, lastSeenAt: now },
    });
    return true;
  } catch (err) {
    logger.warn(
      `webhook skip record failed (store=${input.storeId} reason=${input.reason}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
