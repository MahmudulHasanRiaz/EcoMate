import { getQueueToken } from '@nestjs/bullmq';
import type { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';

/** Every BullMQ queue in the backend (Phase 8 audit 02 §1.4). */
export const OBSERVED_QUEUES = [
  'backup',
  'courier-settlement-import',
  'marketing',
  'media',
  'email',
  'import',
  'security-events',
  'security-aggregate',
  'tracking',
  'tracking-dlq',
] as const;

export type ObservedQueueName = (typeof OBSERVED_QUEUES)[number];

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

/**
 * Resolve the live Queue instances from the application context without
 * importing the ten queue-owning modules (which would invite import cycles).
 * Queues that cannot be resolved are skipped — the caller logs the gap.
 */
export function resolveQueues(
  moduleRef: ModuleRef | undefined,
): Map<ObservedQueueName, Queue> {
  const resolved = new Map<ObservedQueueName, Queue>();
  if (!moduleRef) return resolved;
  for (const name of OBSERVED_QUEUES) {
    try {
      const queue = moduleRef.get<Queue>(getQueueToken(name), {
        strict: false,
      });
      if (queue) resolved.set(name, queue);
    } catch {
      // Missing queue: the caller decides whether to warn.
    }
  }
  return resolved;
}

export async function getQueueCounts(queue: Queue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}
