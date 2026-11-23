/**
 * BullMQ priorities for the order-ingest / reconcile queues (Phase 9
 * G-14, ported from jannat J-04). Lower number = processed sooner.
 *
 * BullMQ detail that makes this work: jobs are popped from the
 * prioritized set lowest-score-first, and the score is
 * `priority * 2^32 + sequence` — so a priority-1 job always beats a
 * priority-5 job, and same-priority jobs stay FIFO. Jobs with NO
 * priority (0) go to the plain wait list, which the worker drains
 * BEFORE the prioritized set — so every queue that uses priorities
 * must set a `defaultJobOptions.priority` (see stores.module.ts) or
 * unprioritized jobs would jump the queue. The defaults there are:
 * ingest = webhook (5), reconcile = reconciliation (10); a manual
 * retry MUST pass `manual-retry` (1) explicitly at its enqueue site
 * (Builder B's replay endpoint).
 */
export const WEBHOOK_PRIORITY = {
  /** Operator-triggered manual retry / replay — jumps the queue. */
  'manual-retry': 1,
  /** Live webhook delivery — the normal ingest path. */
  webhook: 5,
  /** Scheduled / manual reconciliation — yields to live webhooks. */
  reconciliation: 10,
} as const;

export type WebhookPriorityTrigger = keyof typeof WEBHOOK_PRIORITY;

export function priorityForTrigger(trigger: WebhookPriorityTrigger): number {
  return WEBHOOK_PRIORITY[trigger];
}
