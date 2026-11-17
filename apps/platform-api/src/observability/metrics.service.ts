import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Phase 8 Stage 2 item 20 — Prometheus ops metrics (platform API).
 *
 * Served at GET /metrics (root, outside the /api prefix — the business
 * metrics live at /api/metrics/overview and are untouched). Label
 * discipline: method/route/status_code for HTTP, job name for billing
 * jobs, host for TLS probes (bounded by the verified-custom-domain count).
 * Never tenant ids or raw paths.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpDuration: Histogram<string>;
  private readonly httpRequests: Counter<string>;
  private readonly billingJobLastRun: Gauge<string>;
  private readonly billingJobLastSuccess: Gauge<string>;
  private readonly billingJobErrors: Counter<string>;
  private readonly tlsCertExpiryDays: Gauge<string>;
  private readonly tlsProbeSuccess: Gauge<string>;
  private readonly primaryDomainHealthy: Gauge<string>;
  private readonly alertsSent: Counter<string>;

  constructor() {
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
    this.billingJobLastRun = new Gauge({
      name: 'billing_job_last_run_timestamp_seconds',
      help: 'Unix timestamp of the last billing job run, by job',
      labelNames: ['job'],
      registers: [this.registry],
    });
    this.billingJobLastSuccess = new Gauge({
      name: 'billing_job_last_success',
      help: '1 when the last billing job run had no errors, else 0',
      labelNames: ['job'],
      registers: [this.registry],
    });
    this.billingJobErrors = new Counter({
      name: 'billing_job_errors_total',
      help: 'Billing job runs that ended with errors, by job',
      labelNames: ['job'],
      registers: [this.registry],
    });
    this.tlsCertExpiryDays = new Gauge({
      name: 'tls_cert_expiry_days',
      help: 'Days until the TLS certificate expires for a verified custom domain (-1 when unknown)',
      labelNames: ['host'],
      registers: [this.registry],
    });
    this.tlsProbeSuccess = new Gauge({
      name: 'tls_probe_success',
      help: '1 when the last TLS probe of a verified custom domain succeeded, else 0',
      labelNames: ['host'],
      registers: [this.registry],
    });
    this.primaryDomainHealthy = new Gauge({
      name: 'primary_domain_healthy',
      help: '1 when the primary domain probe reports healthy, else 0',
      registers: [this.registry],
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

  /** Billing-job outcome (called by JobFailureWatcherService). */
  recordBillingJobRun(
    job: string,
    ranAt: Date,
    hadErrors: boolean,
  ): void {
    this.billingJobLastRun.set({ job }, Math.floor(ranAt.getTime() / 1000));
    this.billingJobLastSuccess.set({ job }, hadErrors ? 0 : 1);
    if (hadErrors) this.billingJobErrors.inc({ job });
  }

  /** TLS probe outcome (called by TlsHealthService). */
  recordTlsProbe(
    host: string,
    success: boolean,
    expiryDays: number | null,
  ): void {
    this.tlsProbeSuccess.set({ host }, success ? 1 : 0);
    this.tlsCertExpiryDays.set({ host }, expiryDays ?? -1);
  }

  recordPrimaryHealth(healthy: boolean): void {
    this.primaryDomainHealthy.set(healthy ? 1 : 0);
  }

  incAlert(kind: string, result: 'sent' | 'failed' | 'skipped'): void {
    this.alertsSent.inc({ kind, result });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
