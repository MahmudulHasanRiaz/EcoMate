import { describe, expect, it } from 'vitest'
import {
  emailsForAmount,
  expiryPreviewLine,
  rateLabel,
  type TopUpRateInfo,
} from './lib'

const PER_EMAIL: TopUpRateInfo = {
  rateConfigured: true,
  unit: 'PER_EMAIL',
  pricePerUnit: 0.5,
  minimumBDT: 0.5,
  expiryMode: 'NONE',
  expiryDays: null,
}

const PER_1000: TopUpRateInfo = {
  rateConfigured: true,
  unit: 'PER_1000',
  pricePerUnit: 500,
  minimumBDT: 0.5,
  expiryMode: 'FIXED_DAYS',
  expiryDays: 30,
}

describe('emailsForAmount', () => {
  it('converts per-email rates with floor rounding', () => {
    expect(emailsForAmount(500, 'PER_EMAIL', 0.5)).toBe(1000)
    expect(emailsForAmount(500.4, 'PER_EMAIL', 0.5)).toBe(1000)
    expect(emailsForAmount(0.5, 'PER_EMAIL', 0.5)).toBe(1)
    expect(emailsForAmount(0.49, 'PER_EMAIL', 0.5)).toBe(0)
  })

  it('converts per-1000 rates with floor rounding', () => {
    expect(emailsForAmount(500, 'PER_1000', 500)).toBe(1000)
    expect(emailsForAmount(250, 'PER_1000', 500)).toBe(500)
    expect(emailsForAmount(0.49, 'PER_1000', 500)).toBe(0)
  })

  it('returns 0 when the rate is unconfigured or invalid', () => {
    expect(emailsForAmount(500, 'PER_EMAIL', null)).toBe(0)
    expect(emailsForAmount(500, 'PER_EMAIL', 0)).toBe(0)
    expect(emailsForAmount(500, 'PER_EMAIL', -1)).toBe(0)
    expect(emailsForAmount(-100, 'PER_EMAIL', 0.5)).toBe(0)
  })

  it('does not lose a whole email to float error (৳1 @ ৳0.10/email = 10)', () => {
    expect(emailsForAmount(1, 'PER_EMAIL', 0.1)).toBe(10)
  })
})

describe('rateLabel', () => {
  it('labels per-email and per-1000 rates', () => {
    expect(rateLabel('PER_EMAIL', 0.5)).toBe('৳0.50/email')
    expect(rateLabel('PER_1000', 500)).toBe('৳500.00/1,000 emails')
  })

  it('returns null when unconfigured', () => {
    expect(rateLabel('PER_EMAIL', null)).toBeNull()
    expect(rateLabel('PER_EMAIL', 0)).toBeNull()
  })
})

describe('expiryPreviewLine', () => {
  it('says never expires for NONE', () => {
    expect(expiryPreviewLine(PER_EMAIL)).toBe('These emails never expire.')
  })

  it('dates FIXED_DAYS from today', () => {
    const line = expiryPreviewLine(PER_1000, new Date('2026-11-18T00:00:00Z'))
    expect(line).toBe('These emails expire on 18 Dec 2026.')
  })

  it('names the rule for END_OF_PERIOD', () => {
    expect(
      expiryPreviewLine({ ...PER_EMAIL, expiryMode: 'END_OF_PERIOD' }),
    ).toBe('These emails expire at the end of your current billing period.')
  })
})
