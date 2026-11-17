import { MetricsService } from './metrics.service';

describe('MetricsService (platform-api)', () => {
  it('serves real HTTP series after observations', async () => {
    const service = new MetricsService();
    service.observeHttp('GET', '/api/tenants/:id', 200, 0.03);
    service.observeHttp('POST', '/api/jobs/:name/run', 200, 0.9);

    const text = await service.getMetrics();
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/tenants/:id",status_code="200"} 1',
    );
    expect(text).toContain('http_request_duration_seconds_bucket');
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('records billing job outcomes (success + error counting)', async () => {
    const service = new MetricsService();
    const at = new Date('2026-11-17T00:00:00.000Z');
    service.recordBillingJobRun('trial-expiry', at, false);
    service.recordBillingJobRun('reminders', at, true);
    service.recordBillingJobRun('reminders', at, true);

    const text = await service.getMetrics();
    expect(text).toContain(
      'billing_job_last_run_timestamp_seconds{job="trial-expiry"} 1794873600',
    );
    expect(text).toContain(
      'billing_job_last_success{job="trial-expiry"} 1',
    );
    expect(text).toContain('billing_job_last_success{job="reminders"} 0');
    expect(text).toContain(
      'billing_job_errors_total{job="reminders"} 2',
    );
    expect(text).not.toContain('billing_job_errors_total{job="trial-expiry"}');
  });

  it('records TLS probe outcomes per host', async () => {
    const service = new MetricsService();
    service.recordTlsProbe('shop.example.com', true, 42);
    service.recordTlsProbe('dead.example.com', false, null);

    const text = await service.getMetrics();
    expect(text).toContain(
      'tls_probe_success{host="shop.example.com"} 1',
    );
    expect(text).toContain(
      'tls_cert_expiry_days{host="shop.example.com"} 42',
    );
    expect(text).toContain('tls_probe_success{host="dead.example.com"} 0');
    expect(text).toContain(
      'tls_cert_expiry_days{host="dead.example.com"} -1',
    );
  });

  it('records primary-domain health', async () => {
    const service = new MetricsService();
    service.recordPrimaryHealth(false);
    const text = await service.getMetrics();
    expect(text).toContain('primary_domain_healthy 0');
  });

  it('counts alerts by kind and result', async () => {
    const service = new MetricsService();
    service.incAlert('billing-job-failure', 'sent');
    const text = await service.getMetrics();
    expect(text).toContain(
      'ops_alerts_total{kind="billing-job-failure",result="sent"} 1',
    );
  });

  it('never puts tenant ids in labels', async () => {
    const service = new MetricsService();
    service.observeHttp('GET', '/api/tenants/:id', 200, 0.01);
    const text = await service.getMetrics();
    expect(text).not.toContain('tenantId');
  });

  it('uses one registry per instance (no duplicate-registration crash)', async () => {
    const a = new MetricsService();
    const b = new MetricsService();
    a.observeHttp('GET', '/x', 200, 0.01);
    await expect(a.getMetrics()).resolves.toContain('http_requests_total');
    await expect(b.getMetrics()).resolves.toContain('http_requests_total');
  });
});
