// In-memory per-IP guards that Better Auth's built-in rate limiter cannot
// express on its own (single rule per path, rolling window, no extended
// block). These mirror the two current limiters the service replaces:
//
// 1. Tenant hijack limiter (apps/backend/src/main.ts): 10 attempts per
//    IP+endpoint per minute, then 429 for 15 minutes. Implemented here as:
//    10 *failed* sign-ins from one IP within 60 s → that IP is blocked from
//    /sign-in/email for 15 min. (Counting failures, not all attempts: a
//    successful login never contributes to a block. The per-IP *rate* itself
//    is enforced by BA's customRules — 10/min — this layer adds the 15-min
//    block the rolling window cannot.)
// 2. Platform MFA challenge limiter: POST /auth/mfa/challenge 10/10 min per
//    IP. Implemented as: 10 verify-totp / verify-backup-code attempts from
//    one IP within 600 s → 429 for the rest of the window.
//
// In-memory by design (single-instance service; BA's own default storage is
// also memory). A multi-replica deployment must move these counters to
// shared storage — see README "Scaling notes".
export interface IpLimitConfig {
  maxFailures: number;
  windowSeconds: number;
  blockMinutes: number;
}

interface IpEntry {
  /** Timestamps (ms) of counted events inside the current window. */
  events: number[];
  /** Until when the IP is blocked (ms epoch), or 0. */
  blockedUntil: number;
}

export class IpLimiter {
  private readonly entries = new Map<string, IpEntry>();

  constructor(private readonly config: IpLimitConfig) {}

  private entry(ip: string): IpEntry {
    let e = this.entries.get(ip);
    if (!e) {
      e = { events: [], blockedUntil: 0 };
      this.entries.set(ip, e);
    }
    return e;
  }

  private prune(e: IpEntry, now: number): void {
    const cutoff = now - this.config.windowSeconds * 1000;
    e.events = e.events.filter((t) => t >= cutoff);
    if (this.entries.size > 10_000) {
      // Bound memory: drop the oldest entries (best-effort LRU by insertion).
      const first = this.entries.keys().next().value;
      if (first !== undefined) this.entries.delete(first);
    }
  }

  isBlocked(ip: string): boolean {
    const e = this.entries.get(ip);
    if (!e) return false;
    if (e.blockedUntil > Date.now()) return true;
    return false;
  }

  /**
   * Record one counted event (a failed sign-in, or an MFA-challenge
   * attempt). When the threshold is reached the IP becomes blocked for
   * *subsequent* requests — the event that trips the threshold is still
   * processed normally (so exactly `maxFailures` attempts are allowed per
   * window, matching the tenant/platform limiters).
   */
  record(ip: string): void {
    const now = Date.now();
    const e = this.entry(ip);
    if (e.blockedUntil > now) return;
    this.prune(e, now);
    e.events.push(now);
    if (e.events.length >= this.config.maxFailures) {
      e.blockedUntil = now + this.config.blockMinutes * 60_000;
      e.events = [];
    }
  }

  /** A successful sign-in clears the IP's failure history. */
  reset(ip: string): void {
    this.entries.delete(ip);
  }

  /** Test-only. */
  __size(): number {
    return this.entries.size;
  }
}
