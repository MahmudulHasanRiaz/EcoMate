export type AccessState = 'full' | 'grace' | 'read_only' | 'suspended'

export const ACCESS_STATE_META: Record<
  AccessState,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  full: { label: 'Active', variant: 'default' },
  grace: { label: 'Grace period', variant: 'secondary' },
  read_only: { label: 'Read only', variant: 'destructive' },
  suspended: { label: 'Suspended', variant: 'destructive' },
}

/** Roles allowed to take subscription actions (proof submit, plan-change request). */
export function canManageSubscription(role: string | undefined | null): boolean {
  return role === 'superadmin' || role === 'admin'
}

export function prettyFeature(feature: string): string {
  return feature
    .replace(/^admin_/, '')
    .replace(/^storefront_/, 'storefront · ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function money(amount: number | string, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Whole calendar days from today until `validUntil`. A renewal later today
 * is 0 ("Renews today"), tomorrow is 1, yesterday is -1. Returns null when
 * there is no (parseable) renewal date.
 */
export function daysUntil(validUntil: string | null | undefined): number | null {
  if (!validUntil) return null
  const date = new Date(validUntil)
  if (Number.isNaN(date.getTime())) return null
  const startOfDay = (d: Date) => {
    const copy = new Date(d)
    copy.setHours(0, 0, 0, 0)
    return copy.getTime()
  }
  return Math.round(
    (startOfDay(date) - startOfDay(new Date())) / (24 * 60 * 60 * 1000),
  )
}

/** Plain-language countdown for the renewal date. */
export function daysLeftLabel(validUntil: string | null | undefined): string {
  const days = daysUntil(validUntil)
  if (days === null) return 'No renewal date'
  if (days < 0) return 'Expired'
  if (days === 0) return 'Renews today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

/** The dashboard warning banner shows when renewal is near or access is degraded. */
export function needsSubscriptionWarning(
  validUntil: string | null | undefined,
  accessState: AccessState | null | undefined,
): boolean {
  if (accessState && accessState !== 'full') return true
  const days = daysUntil(validUntil)
  return days !== null && days <= 7
}
