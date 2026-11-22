/**
 * Per-store circuit breaker in Redis — central-commerce §8.1 (P4, Jannat §4.1).
 *
 * Closed → calls flow. 5 consecutive failures → OPEN for 60s (no calls).
 * After the open window a single half-open probe is allowed; success closes,
 * failure re-opens. State key: `store:breaker:<storeId>` (tenant-scoped by
 * CacheService — workers run in tenant context, so two tenants' breakers
 * for the same storeId can never collide; storeIds are globally unique
 * anyway).
 *
 * SaaS port note: upstream's docstring said Redis but the implementation
 * was an in-memory Map (per-process — useless across replicas). This port
 * is genuinely Redis-backed via CacheService. One deliberate weakening:
 * the half-open probe claim is read-modify-write, not atomic, so two
 * workers can rarely both probe after an outage — harmless (both outcomes
 * are recorded; the provider sees two calls instead of one). A CacheService
 * failure fails OPEN (allow) with a warning: blocking all sync because
 * the breaker store is down is worse, and BullMQ needs Redis anyway.
 */
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const OPEN_AFTER_FAILURES = 5;
const OPEN_WINDOW_MS = 60_000;
/** Record TTL — covers the open window plus margin; stale records self-clean. */
const BREAKER_RECORD_TTL_MS = 10 * 60_000;

interface BreakerRecord {
  failures: number;
  openedAt: number | null;
  halfOpenInFlight: boolean;
}

const FRESH_RECORD: BreakerRecord = {
  failures: 0,
  openedAt: null,
  halfOpenInFlight: false,
};

@Injectable()
export class StoreCircuitBreaker {
  private readonly logger = new Logger(StoreCircuitBreaker.name);

  constructor(private readonly cache: CacheService) {}

  private key(storeId: string): string {
    return `store:breaker:${storeId}`;
  }

  private async read(storeId: string): Promise<BreakerRecord> {
    try {
      const rec = await this.cache.get<BreakerRecord>(this.key(storeId));
      return rec ?? { ...FRESH_RECORD };
    } catch (err) {
      this.logger.warn(`breaker read failed for ${storeId} (fail-open): ${err}`);
      return { ...FRESH_RECORD };
    }
  }

  private async write(storeId: string, rec: BreakerRecord): Promise<void> {
    try {
      await this.cache.set(this.key(storeId), rec, BREAKER_RECORD_TTL_MS);
    } catch (err) {
      this.logger.warn(`breaker write failed for ${storeId}: ${err}`);
    }
  }

  /** True when a call may proceed (closed, or the single half-open probe). */
  async allow(storeId: string, now = Date.now()): Promise<boolean> {
    const rec = await this.read(storeId);
    if (rec.openedAt === null) return true;
    if (now - rec.openedAt < OPEN_WINDOW_MS) return false;
    if (rec.halfOpenInFlight) return false;
    rec.halfOpenInFlight = true;
    await this.write(storeId, rec);
    return true;
  }

  async state(storeId: string, now = Date.now()): Promise<BreakerState> {
    const rec = await this.read(storeId);
    if (rec.openedAt === null) return 'CLOSED';
    if (now - rec.openedAt < OPEN_WINDOW_MS) return 'OPEN';
    return 'HALF_OPEN';
  }

  async success(storeId: string): Promise<void> {
    await this.write(storeId, { ...FRESH_RECORD });
  }

  async failure(storeId: string, now = Date.now()): Promise<BreakerState> {
    const rec = await this.read(storeId);
    if (rec.halfOpenInFlight) {
      rec.halfOpenInFlight = false;
      rec.openedAt = now;
      await this.write(storeId, rec);
      this.logger.warn(`Circuit re-opened for store ${storeId} (half-open probe failed)`);
      return 'OPEN';
    }
    rec.failures += 1;
    if (rec.failures >= OPEN_AFTER_FAILURES) {
      rec.openedAt = now;
      await this.write(storeId, rec);
      this.logger.warn(`Circuit opened for store ${storeId} after ${rec.failures} failures`);
      return 'OPEN';
    }
    await this.write(storeId, rec);
    return 'CLOSED';
  }
}
