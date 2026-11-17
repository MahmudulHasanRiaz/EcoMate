import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Queue } from 'bullmq';

export interface QueueHealth {
  name: string;
  ok: boolean;
  /** Failed-job count (informational — failed jobs do not fail readiness). */
  failed: number;
}

const QUEUE_CHECK_TIMEOUT_MS = 2_000;

/**
 * Best-effort BullMQ health: discovers every Queue provider in the app
 * (via DiscoveryService, so no module coupling) and pings each one with a
 * cheap `getJobCounts('failed')` call.
 *
 * A queue that errors or times out fails the check. A queue with failed
 * jobs does NOT fail readiness — failed jobs are an operator signal, not
 * a sign the instance cannot serve traffic. Zero discovered queues is
 * reported, not failed: queue providers may simply not be instantiated
 * yet at probe time.
 */
@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);

  constructor(private readonly discovery: DiscoveryService) {}

  async check(): Promise<{ ok: boolean; queues: QueueHealth[] }> {
    const queues = this.discoverQueues();
    const results = await Promise.all(
      queues.map((queue) => this.checkOne(queue)),
    );
    return {
      ok: results.every((result) => result.ok),
      queues: results,
    };
  }

  private discoverQueues(): Queue[] {
    try {
      return this.discovery
        .getProviders()
        .map((provider) => provider.instance)
        .filter((instance): instance is Queue => instance instanceof Queue);
    } catch (err) {
      this.logger.warn(
        `Queue discovery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async checkOne(queue: Queue): Promise<QueueHealth> {
    const name = queue.name;
    try {
      const counts = await Promise.race([
        queue.getJobCounts('failed'),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('queue check timed out')),
            QUEUE_CHECK_TIMEOUT_MS,
          ),
        ),
      ]);
      return { name, ok: true, failed: counts.failed ?? 0 };
    } catch (err) {
      this.logger.warn(
        `Queue health check failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { name, ok: false, failed: 0 };
    }
  }
}
