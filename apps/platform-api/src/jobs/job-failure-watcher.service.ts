import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { AlertsService } from '../observability/alerts.service';
import { MetricsService } from '../observability/metrics.service';
import { BillingJobsService, type JobName } from './billing-jobs.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Phase 8 Stage 2 item 20 — billing-job failure alerting WITHOUT touching
 * the billing jobs themselves: this watcher polls BillingJobsService.status()
 * (the in-memory lastRuns map) every JOB_WATCHER_INTERVAL_MS (default 5
 * min) and emails ops when a job's latest run carries an error it has not
 * already alerted on. It also pushes the run outcomes into the Prometheus
 * billing-job gauges.
 *
 * Alert-on-new-error only: the same failing run is alerted once (keyed by
 * job + lastRunAt + first error). A job that keeps failing on every hourly
 * tick alerts once per failing RUN, throttled per kind by AlertsService.
 */
@Injectable()
export class JobFailureWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobFailureWatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly alertedErrors = new Map<JobName, string>();
  private readonly recordedRuns = new Map<JobName, string>();

  constructor(
    private readonly jobs: BillingJobsService,
    @Optional() private readonly alerts?: AlertsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    if (process.env.JOB_WATCHER_ENABLED === 'false') {
      this.logger.log(
        'Billing-job watcher disabled (JOB_WATCHER_ENABLED=false)',
      );
      return;
    }
    const interval = Number(process.env.JOB_WATCHER_INTERVAL_MS);
    const ms =
      Number.isFinite(interval) && interval >= 10_000
        ? interval
        : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.check().catch((error) => {
        this.logger.error(
          `Billing-job watcher tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, ms);
    this.timer.unref?.();
    this.logger.log(`Billing-job watcher scheduled every ${ms}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One poll cycle. Returns the job names alerted on in this cycle. */
  async check(): Promise<JobName[]> {
    const alerted: JobName[] = [];
    const { jobs } = this.jobs.status();
    for (const job of jobs) {
      if (!job.lastRunAt) continue;
      // Metrics: record each run once (a re-poll of the same run is a no-op
      // for the gauges, but re-setting identical values is harmless — the
      // errors counter must NOT double-count, hence the guard).
      const runKey = `${job.name}@${job.lastRunAt}`;
      const hadErrors =
        (job.lastResult?.errors.length ?? 0) > 0 || job.lastError !== null;
      if (this.recordedRuns.get(job.name) !== runKey) {
        this.recordedRuns.set(job.name, runKey);
        this.metrics?.recordBillingJobRun(
          job.name,
          new Date(job.lastRunAt),
          hadErrors,
        );
      }
      if (!hadErrors) continue;
      const firstError =
        job.lastError ?? job.lastResult?.errors[0] ?? 'unknown error';
      const errorKey = `${job.lastRunAt}:${firstError}`;
      if (this.alertedErrors.get(job.name) === errorKey) continue;
      this.alertedErrors.set(job.name, errorKey);
      const errorCount = job.lastResult?.errors.length ?? 1;
      await this.alerts?.sendAlert({
        kind: 'billing-job-failure',
        subject: `Billing job ${job.name} failed`,
        text:
          `Billing job "${job.name}" ran at ${job.lastRunAt} with ` +
          `${errorCount} error(s).\n\nFirst error: ${firstError}\n\n` +
          `Check GET /api/jobs for the full run, then re-run with ` +
          `POST /api/jobs/${job.name}/run after fixing the cause.`,
      });
      alerted.push(job.name);
    }
    return alerted;
  }
}
