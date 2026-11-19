import { describe, it, expect } from 'vitest'
import { currentBalance, rateAtPurchase, estimate, monthsBetween } from './opportunity-estimates.ts'

// Weekly PMMS rows, Thursdays.
const PMMS = [
  { week_date: '2021-04-01', rate_30_fixed: 3.18 },
  { week_date: '2021-04-08', rate_30_fixed: 3.13 },
  { week_date: '2021-04-15', rate_30_fixed: 3.04 },
  { week_date: '2021-04-22', rate_30_fixed: 2.97 },
  { week_date: '2021-04-29', rate_30_fixed: 2.98 },
  { week_date: '2021-05-06', rate_30_fixed: 2.96 },
  { week_date: '2021-05-13', rate_30_fixed: 2.94 },
  { week_date: '2026-11-12', rate_30_fixed: 6.25 },
]

describe('currentBalance', () => {
  it('$300,000 at 6.5% for 30 years after 60 payments is $280,833', () => {
    expect(Math.round(currentBalance(300_000, 6.5, 60))).toBe(280_833)
  })
  it('is zero once the loan is paid off', () => {
    expect(currentBalance(300_000, 6.5, 360)).toBe(0)
  })
})

describe('rateAtPurchase', () => {
  it('averages the 6 PMMS weeks before the recording date', () => {
    // Window is 2021-04-02 up to (not including) 2021-05-14: Apr 8 through May 13.
    const avg = (3.13 + 3.04 + 2.97 + 2.98 + 2.96 + 2.94) / 6
    expect(rateAtPurchase('2021-05-14', PMMS)).toBeCloseTo(avg, 3)
  })
  it('returns null for a date before the first seeded week', () => {
    expect(rateAtPurchase('2019-03-01', PMMS)).toBeNull()
  })
})

describe('estimate', () => {
  const now = '2026-11-17'

  it('skips equity math with no loan amount but keeps rate and time owned', () => {
    const e = estimate({ recording_date: '2021-05-14', market_value: 400_000 }, PMMS, { now })
    expect(e.est_balance).toBeNull()
    expect(e.est_equity).toBeNull()
    expect(e.tappable_80).toBeNull()
    expect(e.est_rate).not.toBeNull()
    expect(e.rate_gap).not.toBeNull()
    expect(e.years_owned).toBeGreaterThan(5)
  })

  it('uses the actual Arive rate when there is one', () => {
    const e = estimate(
      { recording_date: '2021-05-14', rate_actual: 7.125, orig_loan_amount: 300_000, market_value: 450_000 },
      PMMS,
      { now },
    )
    expect(e.est_rate).toBe(7.125)
    expect(e.rate_source).toBe('actual')
    expect(e.rate_gap).toBeCloseTo(0.875, 3)
    expect(e.est_balance).toBeLessThan(300_000)
    expect(e.tappable_80).toBe(Math.max(0, Math.round(0.8 * 450_000 - e.est_balance!)))
  })

  it('applies the per-county value adjustment', () => {
    const e = estimate({ recording_date: '2021-05-14', market_value: 400_000, county: 'Harris' }, PMMS, {
      now,
      valueGrowthByCounty: { Harris: 1.05 },
    })
    expect(e.est_value).toBe(420_000)
  })
})

describe('monthsBetween', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2021-05-14', '2026-05-14')).toBe(60)
    expect(monthsBetween('2021-05-14', '2026-05-13')).toBe(59)
  })
})
