/**
 * Pure helpers for the SMTP email-balance system
 * (smtp-balance-design.md §3, §5). No NestJS dependencies — unit-tested
 * in email-balance.utils.spec.ts and shared by SettingsService (which
 * owns the stored `saas_smtp` setting) and EmailBalanceService.
 */

export type SaasSmtpUnit = 'PER_EMAIL' | 'PER_1000';
export type SaasSmtpExpiryMode = 'NONE' | 'FIXED_DAYS' | 'END_OF_PERIOD';

export interface SaasSmtpExpirySettings {
  mode: SaasSmtpExpiryMode;
  /** FIXED_DAYS only; >= 1, no hard cap. */
  days: number;
  /** Warn the tenant this many days before a lot expires. */
  warnDays: number;
}

export interface SaasSmtpSettings {
  unit: SaasSmtpUnit;
  /** BDT per unit. null = SaaS SMTP not priced yet → top-ups disabled. */
  pricePerUnit: number | null;
  /** Free starter emails per tenant (Q11). */
  freeAllowance: number;
  /** Low-balance warning threshold, in emails. */
  lowBalanceThreshold: number;
  expiry: SaasSmtpExpirySettings;
}

/** Hard max for the free allowance (Q11): the console rejects 21+. */
export const SAAS_SMTP_FREE_ALLOWANCE_MAX = 20;

export const DEFAULT_SAAS_SMTP: SaasSmtpSettings = {
  unit: 'PER_EMAIL',
  pricePerUnit: null,
  freeAllowance: 10,
  lowBalanceThreshold: 10,
  expiry: { mode: 'NONE', days: 90, warnDays: 7 },
};

/** Unit size in emails: 1 for PER_EMAIL, 1000 for PER_1000. */
export function unitSize(unit: SaasSmtpUnit): number {
  return unit === 'PER_1000' ? 1000 : 1;
}

/**
 * Is the rate configured well enough to sell top-ups? null/0/negative
 * all mean "not priced" — a 0 price would divide by zero, so it is
 * treated as unpriced rather than free (top-ups stay disabled until the
 * operator sets a real rate).
 */
export function isRateConfigured(settings: SaasSmtpSettings): boolean {
  return (
    typeof settings.pricePerUnit === 'number' &&
    Number.isFinite(settings.pricePerUnit) &&
    settings.pricePerUnit > 0
  );
}

/**
 * Emails a BDT amount buys at the current rate: floor(amount / price ×
 * unitSize). Floor, never round — the tenant never receives more than
 * they paid for. Computed in integer micro-units (1e-6 BDT) so float
 * representation error can never push a whole-number result over or
 * under the boundary (e.g. ৳500 at ৳0.50/email is exactly 1000).
 * Returns 0 when the rate is not configured.
 */
export function emailsForAmount(
  amountBDT: number,
  settings: SaasSmtpSettings,
): number {
  if (!isRateConfigured(settings)) return 0;
  const price = settings.pricePerUnit as number;
  const amountMicro = Math.round(amountBDT * 1_000_000);
  const priceMicro = Math.round(price * 1_000_000);
  if (amountMicro <= 0 || priceMicro <= 0) return 0;
  return Math.floor((amountMicro * unitSize(settings.unit)) / priceMicro);
}

/**
 * Minimum top-up in BDT: the price of 1 email. With a per-1000 price of
 * ৳500 the minimum is ৳0.50, so in practice any sensible amount works;
 * the rule exists to prevent a tiny payment granting 0 emails. Null
 * when the rate is not configured.
 */
export function minimumTopUpBDT(settings: SaasSmtpSettings): number | null {
  if (!isRateConfigured(settings)) return null;
  const price = settings.pricePerUnit as number;
  return price / unitSize(settings.unit);
}

/** True when the amount buys at least one email at the current rate. */
export function isValidTopUpAmount(
  amountBDT: number,
  settings: SaasSmtpSettings,
): boolean {
  return emailsForAmount(amountBDT, settings) >= 1;
}

const DAY_MS = 86_400_000;

/**
 * Expiry for a lot granted now (§5.1). NONE → null (never expires);
 * FIXED_DAYS → grantedAt + days; END_OF_PERIOD → the tenant's
 * currentPeriodEnd at grant time, falling back to grantedAt + 30d when
 * the tenant has no subscription period (or it already ended).
 * Grandfathering (§5.2) is enforced by the caller: this is computed
 * once at grant time and never recomputed.
 */
export function computeExpiresAt(
  settings: SaasSmtpSettings,
  grantedAt: Date,
  currentPeriodEnd?: Date | null,
): Date | null {
  const mode = settings.expiry.mode;
  if (mode === 'NONE') return null;
  if (mode === 'FIXED_DAYS') {
    const days = Math.max(1, Math.floor(settings.expiry.days) || 1);
    return new Date(grantedAt.getTime() + days * DAY_MS);
  }
  // END_OF_PERIOD
  if (currentPeriodEnd && currentPeriodEnd.getTime() > grantedAt.getTime()) {
    return new Date(currentPeriodEnd.getTime());
  }
  return new Date(grantedAt.getTime() + 30 * DAY_MS);
}
