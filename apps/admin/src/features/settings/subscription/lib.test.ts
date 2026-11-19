import { describe, it, expect } from 'vitest'
import {
  canManageSubscription,
  daysLeftLabel,
  daysUntil,
  needsSubscriptionWarning,
} from './lib'

const DAY = 24 * 60 * 60 * 1000

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

/** Noon N days from today — safely inside that calendar day. */
function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

describe('daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil(isoDaysFromNow(30))).toBe(30)
    expect(daysUntil(isoDaysFromNow(1))).toBe(1)
  })

  it('returns 0 for a renewal later today or just passed', () => {
    expect(daysUntil(isoFromNow(2 * 60 * 60 * 1000))).toBe(0)
    expect(daysUntil(isoFromNow(-60 * 60 * 1000))).toBe(0)
  })

  it('returns negative days once expired', () => {
    expect(daysUntil(isoDaysFromNow(-2))).toBe(-2)
  })

  it('returns null without a parseable date', () => {
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil(undefined)).toBeNull()
    expect(daysUntil('not-a-date')).toBeNull()
  })
})

describe('daysLeftLabel', () => {
  it('covers every countdown state', () => {
    expect(daysLeftLabel(isoFromNow(30 * DAY))).toBe('30 days left')
    expect(daysLeftLabel(isoFromNow(DAY))).toBe('1 day left')
    expect(daysLeftLabel(isoDaysFromNow(0))).toBe('Renews today')
    expect(daysLeftLabel(isoFromNow(-2 * DAY))).toBe('Expired')
    expect(daysLeftLabel(null)).toBe('No renewal date')
  })
})

describe('needsSubscriptionWarning', () => {
  it('warns at 7 days or fewer', () => {
    expect(needsSubscriptionWarning(isoFromNow(7 * DAY), 'full')).toBe(true)
    expect(needsSubscriptionWarning(isoFromNow(6 * DAY), 'full')).toBe(true)
    expect(needsSubscriptionWarning(isoFromNow(8 * DAY), 'full')).toBe(false)
  })

  it('warns for any degraded access state, however far renewal is', () => {
    expect(needsSubscriptionWarning(isoFromNow(30 * DAY), 'grace')).toBe(true)
    expect(needsSubscriptionWarning(isoFromNow(30 * DAY), 'read_only')).toBe(true)
    expect(needsSubscriptionWarning(isoFromNow(30 * DAY), 'suspended')).toBe(true)
    expect(needsSubscriptionWarning(null, 'grace')).toBe(true)
  })

  it('stays silent for a healthy subscription with no date', () => {
    expect(needsSubscriptionWarning(null, 'full')).toBe(false)
    expect(needsSubscriptionWarning(null, undefined)).toBe(false)
  })
})

describe('canManageSubscription', () => {
  it('allows only superadmin and admin', () => {
    expect(canManageSubscription('superadmin')).toBe(true)
    expect(canManageSubscription('admin')).toBe(true)
    expect(canManageSubscription('employee')).toBe(false)
    expect(canManageSubscription('cashier')).toBe(false)
    expect(canManageSubscription('packing_assistant')).toBe(false)
    expect(canManageSubscription('customer')).toBe(false)
    expect(canManageSubscription(undefined)).toBe(false)
    expect(canManageSubscription(null)).toBe(false)
  })
})
