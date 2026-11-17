import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { TenantPrismaManager } from '../tenancy/tenant-prisma.manager';
import {
  OBSERVED_QUEUES,
  getQueueCounts,
  resolveQueues,
  type QueueCounts,
} from './queues';

/**
 * Phase 8 Stage 2 item 20 — Prometheus ops metrics (backend).
 *
 * Served at GET /metrics (root, outside the /api prefix) by
 * MetricsController. Label discipline: method/route/status_code only —
 * never tenant ids, user ids, or raw paths (route is the matched Fastify
 * pattern, e.g. /api/products/:id, so cardinality stays bounded by the
 * route table). Queue labels are the 10 fixed queue names × 5 job states.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry = new Registry();
  private readonly httpDuration: Histogram<string>;
  private readonly httpRequests: Counter<string>;
  private readonly queueJobs: Gauge<string>;
  private readonly tenantClients: Gauge<string>;
  private readonly alertsSent: Counter<string>;
  private queueWarned = false;

  constructor(
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly tenantManager?: TenantPrismaManager,
  ) {
    collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    this.queueJobs = new Gauge({
      name: 'bullmq_queue_jobs',
      help: 'BullMQ job counts by queue and state (scrape-time read)',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      // prom-client awaits async collect functions during a scrape.
      collect: async () => {
        await this.collectQueueCounts();
      },
    });
    this.tenantClients = new Gauge({
      name: 'tenant_prisma_clients',
      help: 'Cached per-tenant Prisma clients (pool saturation signal)',
      labelNames: ['state'],
      registers: [this.registry],
      collect: () => {
        if (!this.tenantManager) return;
        const stats = this.tenantManager.getStats();
        this.tenantClients.set({ state: 'cached' }, stats.tenants);
        this.tenantClients.set({ state: 'max' }, stats.maxClients);
      },
    });
    this.alertsSent = new Counter({
      name: 'ops_alerts_total',
      help: 'Ops email alerts attempted, by kind and result',
      labelNames: ['kind', 'result'],
      registers: [this.registry],
    });
  }

  /** HTTP observation entry point (called by HttpMetricsInterceptor). */
  observeHttp(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = {
      method,
      route,
      status_code: String(statusCode),
    };
    this.httpDuration.observe(labels, durationSeconds);
    this.httpRequests.inc(labels);
  }

  incAlert(kind: string, result: 'sent' | 'failed' | 'skipped'): void {
    this.alertsSent.inc({ kind, result });
  }

  /** Direct queue-count push (used by QueueWatcherService between scrapes). */
  setQueueCounts(
    queue: string,
    counts: QueueCounts,
  ): void {
    for (const [state, value] of Object.entries(counts)) {
      this.queueJobs.set({ queue, state }, value);
    }
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  private async collectQueueCounts(): Promise<void> {
    const queues = resolveQueues(this.moduleRef);
    if (queues.size === 0) {
      if (!this.queueWarned) {
        this.queueWarned = true;
        this.logger.warn(
          'No BullMQ queues resolvable for metrics; queue gauges will stay empty',
        );
      }
      return;
    }
    if (queues.size < OBSERVED_QUEUES.length && !this.queueWarned) {
      this.queueWarned = true;
      this.logger.warn(
        `Only ${queues.size}/${OBSERVED_QUEUES.length} queues resolvable for metrics`,
      );
    }
    const results = await Promise.allSettled(
      [...queues.entries()].map(async ([name, queue]) => ({
        name,
        counts: await getQueueCounts(queue),
      })),
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      this.setQueueCounts(result.value.name, result.value.counts);
    }
  }
}
