import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DomainConfigService } from '../config/domain-config.service';
import { AlertsService } from '../observability/alerts.service';
import { MetricsService } from '../observability/metrics.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  NodeTlsProber,
  type TlsProbeResult,
  type TlsProber,
} from './tls-prober';

/**
 * tlsStatus vocabulary (the column was write-only 'PENDING' before Phase 8
 * — nothing ever transitioned it):
 *  - PENDING: verified but never probed yet.
 *  - ACTIVE: TLS valid, reachable, cert not near expiry.
 *  - EXPIRING_SOON: cert expires within TLS_EXPIRY_ALERT_DAYS (default 14).
 *  - EXPIRED: the leaf certificate is past its not-after date.
 *  - UNREACHABLE: handshake failed, chain invalid, or no HTTP answer.
 */
export type TlsStatusValue =
  | 'PENDING'
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'UNREACHABLE';

export interface TlsTransition {
  host: string;
  from: string | null;
  to: TlsStatusValue;
}

export interface TlsHealthRunResult {
  ranAt: string;
  domainsChecked: number;
  transitions: TlsTransition[];
  alertsSent: number;
  primaryProbed: boolean;
  primaryHealthy: boolean | null;
  errors: string[];
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_EXPIRY_ALERT_DAYS = 14;
/** Consecutive primary failures before the probe flips unhealthy (hysteresis). */
const PRIMARY_FAILURES_TO_FLIP = 2;

/** Pure classifier, unit-tested directly. */
export function classifyTlsStatus(
  probe: TlsProbeResult,
  expiryAlertDays: number,
): TlsStatusValue {
  if (probe.expiryDays !== null && probe.expiryDays < 0) return 'EXPIRED';
  if (!probe.tlsOk || !probe.reachable) return 'UNREACHABLE';
  if (
    probe.expiryDays !== null &&
    probe.expiryDays < expiryAlertDays
  ) {
    return 'EXPIRING_SOON';
  }
  return 'ACTIVE';
}

/**
 * Phase 8 Stage 2 item 25 — TLS/domain health job (decision D12).
 *
 * Every TLS_PROBE_INTERVAL_MS (default 1h) it probes each VERIFIED/ACTIVE
 * custom domain (TLS handshake + cert expiry + HTTPS reachability),
 * transitions tlsStatus, and alerts ops on transitions into EXPIRING_SOON,
 * EXPIRED, or UNREACHABLE. Alerts fire on TRANSITION only, so a domain
 * that stays expired does not mail every hour (the per-domain throttle in
 * AlertsService is a second backstop).
 *
 * It also probes the primary domain and drives DomainConfigService's probe
 * state, replacing the manual SAAS_PRIMARY_UNHEALTHY flag with a real
 * probe — the env flag remains a manual override (it forces unhealthy no
 * matter what the probe says). The primary probe runs only when
 * TLS_PRIMARY_PROBE_ENABLED=true, or by default in production; in dev/test
 * the primary domain is usually not a real reachable host, so probing it
 * there would flip the platform to fallback spuriously.
 *
 * The domain query is served by the existing @@index([status]) on
 * TenantDomain — no new index or migration is needed at the expected
 * domain counts.
 */
@Injectable()
export class TlsHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TlsHealthService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRun: TlsHealthRunResult | null = null;
  private consecutivePrimaryFailures = 0;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
    @Optional() private readonly alerts?: AlertsService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly prober: TlsProber = new NodeTlsProber(),
  ) {}

  onModuleInit(): void {
    if (process.env.TLS_PROBE_ENABLED === 'false') {
      this.logger.log('TLS health probe disabled (TLS_PROBE_ENABLED=false)');
      return;
    }
    const interval = Number(process.env.TLS_PROBE_INTERVAL_MS);
    const ms =
      Number.isFinite(interval) && interval >= 60_000
        ? interval
        : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.runProbe().catch((error) => {
        this.logger.error(
          `TLS health tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, ms);
    this.timer.unref?.();
    this.logger.log(`TLS health probe scheduled every ${ms}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  expiryAlertDays(): number {
    const raw = Number(process.env.TLS_EXPIRY_ALERT_DAYS);
    return Number.isFinite(raw) && raw > 0
      ? Math.floor(raw)
      : DEFAULT_EXPIRY_ALERT_DAYS;
  }

  primaryProbeEnabled(): boolean {
    if (process.env.TLS_PRIMARY_PROBE_ENABLED === 'true') return true;
    if (process.env.TLS_PRIMARY_PROBE_ENABLED === 'false') return false;
    return process.env.NODE_ENV === 'production';
  }

  status(): {
    lastRun: TlsHealthRunResult | null;
    primaryProbeEnabled: boolean;
    primaryProbeResult: boolean | null;
    expiryAlertDays: number;
  } {
    return {
      lastRun: this.lastRun,
      primaryProbeEnabled: this.primaryProbeEnabled(),
      primaryProbeResult: this.domainConfig.getPrimaryProbeResult(),
      expiryAlertDays: this.expiryAlertDays(),
    };
  }

  async runProbe(): Promise<TlsHealthRunResult> {
    if (this.running) {
      this.logger.warn('TLS health probe skipped: a run is already in progress');
      return (
        this.lastRun ?? {
          ranAt: new Date().toISOString(),
          domainsChecked: 0,
          transitions: [],
          alertsSent: 0,
          primaryProbed: false,
          primaryHealthy: null,
          errors: ['run already in progress'],
        }
      );
    }
    this.running = true;
    const started = new Date();
    const result: TlsHealthRunResult = {
      ranAt: started.toISOString(),
      domainsChecked: 0,
      transitions: [],
      alertsSent: 0,
      primaryProbed: false,
      primaryHealthy: null,
      errors: [],
    };
    try {
      const domains = await this.prisma.tenantDomain.findMany({
        where: {
          type: 'CUSTOM',
          status: { in: ['VERIFIED', 'ACTIVE'] },
        },
        select: { id: true, host: true, tlsStatus: true },
      });
      result.domainsChecked = domains.length;
      const alertDays = this.expiryAlertDays();
      for (const domain of domains) {
        try {
          const probe = await this.prober.probe(domain.host);
          const next = classifyTlsStatus(probe, alertDays);
          this.metrics?.recordTlsProbe(
            domain.host,
            probe.ok,
            probe.expiryDays,
          );
          if ((domain.tlsStatus ?? 'PENDING') !== next) {
            await this.prisma.tenantDomain.update({
              where: { id: domain.id },
              data: { tlsStatus: next, lastCheckedAt: new Date() },
            });
            result.transitions.push({
              host: domain.host,
              from: domain.tlsStatus,
              to: next,
            });
            this.logger.log(
              `TLS status ${domain.host}: ${domain.tlsStatus ?? 'PENDING'} -> ${next} ` +
                `(expiryDays=${probe.expiryDays ?? '?'}, http=${probe.httpStatus ?? '?'})`,
            );
            if (
              next === 'EXPIRING_SOON' ||
              next === 'EXPIRED' ||
              next === 'UNREACHABLE'
            ) {
              const attempt = await this.alerts?.sendAlert({
                kind: `tls-${domain.host}`,
                subject:
                  next === 'EXPIRING_SOON'
                    ? `TLS certificate for ${domain.host} expires in ${probe.expiryDays} day(s)`
                    : next === 'EXPIRED'
                      ? `TLS certificate for ${domain.host} has EXPIRED`
                      : `Custom domain ${domain.host} is UNREACHABLE`,
                text:
                  `Domain: ${domain.host}\n` +
                  `Status: ${next}\n` +
                  `Certificate expires: ${probe.expiresAt ?? 'unknown'} ` +
                  `(${probe.expiryDays ?? '?'} days)\n` +
                  `TLS error: ${probe.tlsError ?? 'none'}\n` +
                  `HTTP status: ${probe.httpStatus ?? 'none'} (${probe.httpError ?? 'no error'})\n`,
              });
              if (attempt?.sent) result.alertsSent += 1;
            }
          } else {
            await this.prisma.tenantDomain.update({
              where: { id: domain.id },
              data: { lastCheckedAt: new Date() },
            });
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`${domain.host}: ${message}`);
          this.logger.error(`TLS probe failed for ${domain.host}: ${message}`);
        }
      }

      if (this.primaryProbeEnabled()) {
        result.primaryProbed = true;
        const primary = this.domainConfig.getConfig().primaryDomain;
        try {
          const probe = await this.prober.probe(primary);
          const healthy = probe.ok;
          if (healthy) {
            this.consecutivePrimaryFailures = 0;
          } else {
            this.consecutivePrimaryFailures += 1;
          }
          const previouslyHealthy =
            this.domainConfig.getPrimaryProbeResult();
          const flipUnhealthy =
            !healthy &&
            this.consecutivePrimaryFailures >= PRIMARY_FAILURES_TO_FLIP;
          const nextProbeResult = healthy
            ? true
            : flipUnhealthy
              ? false
              : previouslyHealthy;
          if (nextProbeResult !== null && nextProbeResult !== previouslyHealthy) {
            this.domainConfig.setPrimaryProbeResult(nextProbeResult);
            this.logger.log(
              `Primary domain probe: ${primary} is now ${nextProbeResult ? 'healthy' : 'UNHEALTHY'} ` +
                `(tlsOk=${probe.tlsOk}, reachable=${probe.reachable}, http=${probe.httpStatus ?? '?'})`,
            );
            if (!nextProbeResult) {
              const attempt = await this.alerts?.sendAlert({
                kind: 'primary-domain-unhealthy',
                subject: `Primary domain ${primary} is UNHEALTHY`,
                text:
                  `The primary-domain probe failed ${this.consecutivePrimaryFailures} ` +
                  `time(s) in a row. New absolute URLs now use the fallback domain (if configured).\n\n` +
                  `TLS ok: ${probe.tlsOk} (${probe.tlsError ?? 'no error'})\n` +
                  `Reachable: ${probe.reachable} (HTTP ${probe.httpStatus ?? 'none'}: ${probe.httpError ?? 'no error'})\n`,
              });
              if (attempt?.sent) result.alertsSent += 1;
            }
          }
          const current = this.domainConfig.getPrimaryProbeResult();
          result.primaryHealthy = current;
          if (current !== null) this.metrics?.recordPrimaryHealth(current);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`primary ${primary}: ${message}`);
          this.logger.error(`Primary domain probe failed: ${message}`);
        }
      }
    } finally {
      this.running = false;
    }
    this.lastRun = result;
    return result;
  }
}
