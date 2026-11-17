import { getQueueToken } from '@nestjs/bullmq';
import { MetricsService } from './metrics.service';

function fakeModuleRef(
  queues: Record<string, Record<string, number>>,
) {
  return {
    get: (token: string) => {
      const name = String(token).replace('BullQueue_', '');
      const counts = queues[name];
      if (!counts) throw new Error(`No provider for ${token}`);
      return {
        getJobCounts: jest.fn().mockResolvedValue(counts),
      };
    },
  } as any;
}

describe('MetricsService', () => {
  it('serves real HTTP series after observations', async () => {
    const service = new MetricsService();
    service.observeHttp('GET', '/api/products/:id', 200, 0.042);
    service.observeHttp('GET', '/api/products/:id', 200, 0.5);
    service.observeHttp('POST', '/api/orders', 201, 1.2);

    const text = await service.getMetrics();
    expect(text).toContain('http_requests_total{method="GET",route="/api/products/:id",status_code="200"} 2');
    expect(text).toContain('http_requests_total{method="POST",route="/api/orders",status_code="201"} 1');
    expect(text).toContain('http_request_duration_seconds_bucket');
    expect(text).toContain('http_request_duration_seconds_count{method="GET",route="/api/products/:id",status_code="200"} 2');
    // Default process metrics are collected too.
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('exposes the Prometheus content type', () => {
    const service = new MetricsService();
    expect(service.contentType).toContain('text/plain');
  });

  it('counts alerts by kind and result', async () => {
    const service = new MetricsService();
    service.incAlert('backup-failure', 'sent');
    service.incAlert('backup-failure', 'failed');
    const text = await service.getMetrics();
    expect(text).toContain(
      'ops_alerts_total{kind="backup-failure",result="sent"} 1',
    );
    expect(text).toContain(
      'ops_alerts_total{kind="backup-failure",result="failed"} 1',
    );
  });

  it('collects queue counts on scrape', async () => {
    const moduleRef = fakeModuleRef({
      email: { waiting: 3, active: 1, delayed: 0, failed: 2, completed: 9 },
      backup: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 4 },
    });
    const service = new MetricsService(moduleRef);
    const text = await service.getMetrics();
    expect(text).toContain(
      'bullmq_queue_jobs{queue="email",state="waiting"} 3',
    );
    expect(text).toContain(
      'bullmq_queue_jobs{queue="email",state="failed"} 2',
    );
    expect(text).toContain(
      'bullmq_queue_jobs{queue="backup",state="completed"} 4',
    );
  });

  it('reports tenant client cache stats', async () => {
    const manager = {
      getStats: () => ({ tenants: 7, maxClients: 60, idleMs: 600_000 }),
    } as any;
    const service = new MetricsService(undefined, manager);
    const text = await service.getMetrics();
    expect(text).toContain(
      'tenant_prisma_clients{state="cached"} 7',
    );
    expect(text).toContain(
      'tenant_prisma_clients{state="max"} 60',
    );
  });

  it('survives an unresolvable queue registry (empty gauges, no throw)', async () => {
    const service = new MetricsService(fakeModuleRef({}));
    const text = await service.getMetrics();
    expect(text).toContain('http_requests_total');
    expect(text).not.toContain('bullmq_queue_jobs{');
  });

  it('never puts tenant ids in labels (route pattern only)', async () => {
    const service = new MetricsService();
    service.observeHttp(
      'GET',
      '/api/products/:id',
      200,
      0.01,
    );
    const text = await service.getMetrics();
    expect(text).not.toContain('tenantId');
    expect(text).not.toContain('00000000-0000');
  });

  it('uses one registry per instance (no duplicate-registration crash)', async () => {
    const a = new MetricsService();
    const b = new MetricsService();
    a.observeHttp('GET', '/x', 200, 0.01);
    await expect(a.getMetrics()).resolves.toContain('http_requests_total');
    await expect(b.getMetrics()).resolves.toContain('http_requests_total');
  });
});

describe('getQueueToken sanity', () => {
  it('builds the BullMQ provider token used by resolveQueues', () => {
    expect(getQueueToken('backup')).toBe('BullQueue_backup');
  });
});
