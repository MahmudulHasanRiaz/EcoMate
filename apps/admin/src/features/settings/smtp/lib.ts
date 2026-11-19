/**
 * Pure helpers for the tenant SMTP page (top-up preview math + expiry
 * copy). Mirrors the platform's email-balance.utils.ts — the server is
 * the authority (it recomputes on create), the preview just shows the
 * tenant what they will receive before they pay.
 */

export type SaasSmtpUnit = 'PER_EMAIL' | 'PER_1000'
export type SaasSmtpExpiryMode = 'NONE' | 'FIXED_DAYS' | 'END_OF_PERIOD'

export interface ExpiringLot {
  lotId: string
  emailsRemaining: number
  expiresAt: string
}

export interface EmailBalanceSummary {
  balance: number
  lowBalance: boolean
  threshold: number
  expiringSoon: ExpiringLot[]
  topUp: TopUpRateInfo
}

/** GET /settings/smtp response. Counts only — no money balance, ever. */
export interface SmtpSettingsResponse {
  mode: 'BYO' | 'SAAS'
  enabled: boolean
  host: string | null
  port: number | null
  username: string | null
  hasPassword: boolean
  encryption: 'NONE' | 'STARTTLS' | 'SSL'
  fromEmail: string | null
  fromName: string | null
  balance: EmailBalanceSummary | null
  balanceError: string | null
}

export interface TopUpRateInfo {
  rateConfigured: boolean
  unit: SaasSmtpUnit
  pricePerUnit: number | null
  minimumBDT: number | null
  expiryMode: SaasSmtpExpiryMode
  expiryDays: number | null
}

/**
 * Emails a BDT amount buys at the current rate: floor(amount / price ×
 * unitSize), in integer micro-units so float error can never push a
 * whole-number result over the boundary. 0 when the rate is not
 * configured.
 */
export function emailsForAmount(
  amountBDT: number,
  unit: SaasSmtpUnit,
  pricePerUnit: number | null,
): number {
  if (
    typeof pricePerUnit !== 'number' ||
    !Number.isFinite(pricePerUnit) ||
    pricePerUnit <= 0
  ) {
    return 0
  }
  const amountMicro = Math.round(amountBDT * 1_000_000)
  const priceMicro = Math.round(pricePerUnit * 1_000_000)
  if (amountMicro <= 0 || priceMicro <= 0) return 0
  const unitSize = unit === 'PER_1000' ? 1000 : 1
  return Math.floor((amountMicro * unitSize) / priceMicro)
}

/** Human rate label: "৳0.50/email" or "৳500/1,000 emails". */
export function rateLabel(
  unit: SaasSmtpUnit,
  pricePerUnit: number | null,
): string | null {
  if (
    typeof pricePerUnit !== 'number' ||
    !Number.isFinite(pricePerUnit) ||
    pricePerUnit <= 0
  ) {
    return null
  }
  const formatted = `৳${pricePerUnit.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  return unit === 'PER_1000' ? `${formatted}/1,000 emails` : `${formatted}/email`
}

const DAY_MS = 86_400_000

/**
 * Expiry line for the top-up screen (§5.2): the tenant sees when the
 * emails expire BEFORE paying. FIXED_DAYS previews from today (the
 * lot's real expiry is set at credit time and can only be later);
 * END_OF_PERIOD has no client-side date (the period end lives on the
 * platform), so it names the rule instead.
 */
export function expiryPreviewLine(
  rate: TopUpRateInfo,
  now = new Date(),
): string {
  if (rate.expiryMode === 'NONE') return 'These emails never expire.'
  if (rate.expiryMode === 'FIXED_DAYS' && rate.expiryDays) {
    const date = new Date(now.getTime() + rate.expiryDays * DAY_MS)
    const formatted = date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return `These emails expire on ${formatted}.`
  }
  return 'These emails expire at the end of your current billing period.'
}

/** Dhaka date for an expiring lot (short form). */
export function formatExpiryDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
