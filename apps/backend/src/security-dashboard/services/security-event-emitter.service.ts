import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type {
  EmitSecurityEventInput,
  EmitEventResult,
} from '../interfaces/event-emitter.interface';
import { tenantJobPayload } from '../../tenancy/tenant-job';
import { getTenantContext } from '../../tenancy/tenant-context';

const SECURITY_EVENTS_QUEUE = 'security-events';
const AGGREGATE_QUEUE = 'security-aggregate';

/**
 * Fire-and-forget event emitter for the security domain.
 *
 * Production-critical paths call emit() which:
 *  1. Generates dedupKey (UUID per emission instance)
 *  2. Enqueues to BullMQ with dedupKey as jobId (retry safety)
 *  3. Returns immediately — never blocks the request
 *
 * The queue processor handles all DB writes asynchronously.
 */
@Injectable()
export class SecurityEventEmitterService {
  private readonly logger = new Logger(SecurityEventEmitterService.name);

  constructor(
    @InjectQueue(SECURITY_EVENTS_QUEUE) private readonly eventQueue: Queue,
    @InjectQueue(AGGREGATE_QUEUE) private readonly aggregateQueue: Queue,
  ) {}

  /**
   * Emit a security event. Fire-and-forget — never awaits DB writes.
   * Returns immediately with the event ID for tracing purposes.
   */
  async emit(input: EmitSecurityEventInput): Promise<EmitEventResult> {
    const eventId = randomUUID();
    const dedupKey = eventId; // event instance UUID — no time-bucket collapsing

    // Impersonated sessions are stamped by DualModeAuthGuard into the ALS
    // tenant context. Every audited action taken with an impersonated
    // token carries the flag (and the platform actor identity when the
    // impersonation exchange supplied one) in its metadata, so
    // impersonated actions are attributable in the tenant audit trail
    // instead of looking like the owner's own actions. Queue processors
    // and other non-request contexts have no impersonation stamp.
    const impersonation = getTenantContext()?.impersonation;
    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (impersonation?.impersonated) {
      metadata.impersonation = {
        impersonated: true,
        ...(impersonation.actor ? { actor: impersonation.actor } : {}),
      };
    }

    const jobData = {
      ...input,
      id: eventId,
      dedupKey,
      timestamp: new Date().toISOString(), // detection time; processor defaults when absent
      metadata,
      metadataVersion: 1,
    };

    try {
      await this.eventQueue.add(
        SECURITY_EVENTS_QUEUE,
        tenantJobPayload(jobData),
        {
        jobId: dedupKey,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 500,
          removeOnFail: 100,
        },
      );
      return { id: eventId, dedupKey, enqueued: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to enqueue security event: ${message}`);
      return { id: eventId, dedupKey, enqueued: false };
    }
  }

  /**
   * Request an aggregate recalculation (e.g. after backfill or retention cleanup).
   * Separate queue so aggregate updates never block event ingestion.
   */
  async requestAggregateRecalculation(): Promise<void> {
    try {
      await this.aggregateQueue.add(
        'recalculate',
        { triggeredAt: new Date().toISOString() },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to enqueue aggregate recalculation: ${message}`);
    }
  }
}
