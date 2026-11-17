import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { OpsAlertsService } from './ops-alerts.service';
import {
  OBSERVED_QUEUES,
  getQueueCounts,
  resolveQueues,
  type QueueCounts,
} from './queues';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DEPTH_THRESHOLD = 1000;

/**
 * Phase 8 Stage 2 item 20 — queue-depth / failed-job alerting. Polls the 10
 * BullMQ queues every QUEUE_WATCHER_INTERVAL_MS (default 5 min) and emails
 * ops when:
 *  - waiting + delayed depth passes QUEUE_DEPTH_ALERT_THRESHOLD (default
 *    1000 jobs) on any queue, or
 *  - the failed count on any queue INCREASES since the last check (an
 *    absolute failed>0 alert would re-fire forever; the increase is the
 *    signal), or
 *  - a queue cannot be read at all (Redis/queue health failure).
 *
 * Also pushes fresh counts into the metrics gauges between scrapes. The
 * per-kind throttle in OpsAlertsService bounds the mail rate.
 */
@Injectable()
export class QueueWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueWatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly lastFailed = new Map<string, number>();
  private readonly lastDepthAlerted = new Map<string, number>();

  constructor(
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly alerts?: OpsAlertsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    if (process.env.QUEUE_WATCHER_ENABLED === 'false') {
      this.logger.log('Queue watcher disabled (QUEUE_WATCHER_ENABLED=false)');
      return;
    }
    const interval = Number(process.env.QUEUE_WATCHER_INTERVAL_MS);
    const ms =
      Number.isFinite(interval) && interval >= 10_000
        ? interval
        : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.check().catch((error) => {
        this.logger.error(
          `Queue watcher tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, ms);
    this.timer.unref?.();
    this.logger.log(`Queue watcher scheduled every ${ms}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  depthThreshold(): number {
    const raw = Number(process.env.QUEUE_DEPTH_ALERT_THRESHOLD);
    return Number.isFinite(raw) && raw > 0
      ? raw
      : DEFAULT_DEPTH_THRESHOLD;
  }

  /** One poll cycle. Returns per-queue counts (empty when unresolvable). */
  async check(): Promise<Map<string, QueueCounts>> {
    const result = new Map<string, QueueCounts>();
    const queues = resolveQueues(this.moduleRef);
    if (queues.size === 0) {
      this.logger.warn(
        'Queue watcher: no BullMQ queues resolvable — skipping this tick',
      );
      return result;
    }
    const threshold = this.depthThreshold();
    for (const name of OBSERVED_QUEUES) {
      const queue = queues.get(name);
      if (!queue) continue;
      let counts: QueueCounts;
      try {
        counts = await getQueueCounts(queue);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Queue watcher: cannot read ${name}: ${message}`);
        await this.alerts?.sendAlert({
          kind: 'queue-health',
          subject: `Queue ${name} is unreadable`,
          text:
            `The ops queue watcher could not read BullMQ queue "${name}". ` +
            `This usually means Redis is down or the queue is gone.\n\nError: ${message}`,
        });
        continue;
      }
      result.set(name, counts);
      this.metrics?.setQueueCounts(name, counts);
      const depth = counts.waiting + counts.delayed;
      if (depth > threshold) {
        const lastAlert = this.lastDepthAlerted.get(name) ?? 0;
        // Depth alerts re-fire at most once per hour per queue even while
        // the depth stays high (the alerts service also throttles per kind).
        if (Date.now() - lastAlert >= 60 * 60 * 1000) {
          this.lastDepthAlerted.set(name, Date.now());
          await this.alerts?.sendAlert({
            kind: 'queue-depth',
            subject: `Queue ${name} depth ${depth} exceeds ${threshold}`,
            text:
              `BullMQ queue "${name}" has ${counts.waiting} waiting + ` +
              `${counts.delayed} delayed jobs (threshold ${threshold}). ` +
              `Active: ${counts.active}, failed: ${counts.failed}.`,
          });
        }
      }
      const previousFailed = this.lastFailed.get(name);
      if (
        previousFailed !== undefined &&
        counts.failed > previousFailed
      ) {
        await this.alerts?.sendAlert({
          kind: 'queue-failed-jobs',
          subject: `Queue ${name} has ${counts.failed - previousFailed} new failed job(s)`,
          text:
            `BullMQ queue "${name}" failed count rose from ${previousFailed} ` +
            `to ${counts.failed}. Inspect the queue dashboard (/api/admin/queues) ` +
            `or redis for the failing job payloads.`,
        });
      }
      this.lastFailed.set(name, counts.failed);
    }
    return result;
  }
}
