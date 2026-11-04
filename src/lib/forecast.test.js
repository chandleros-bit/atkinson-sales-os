import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FORECAST, resolveForecast, monthKeyOf, avgFundedLoan, mpgPerAccount, forecastLines, forecastByMonth, sortPaysFirst,
} from './forecast'

const NOW = new Date('2026-11-03T09:00:00').getTime()
const rates = { primary_pct: 1.25, assisted_pct: 0.75 }
const settings = resolveForecast(null)
const loan = (o) => ({ id: o.id, role: 'primary', amount: 400000, stage_group: 'processing', funded_on: null, firm_closing_on: null, contact_id: null, borrower_name: 'B', comp_override: null, scenario_auto: false, scenario_override: null, ...o })
const rating = (o) => ({ contact_id: o.contact_id, business_id: 'bay', temperature: 'hot', est_amount: null, close_month: null, name: 'R', ...o })
const map = (...rs) => new Map(rs.map((r) => [r.contact_id, r]))

describe('settings', () => {
  it('fills defaults and drops junk', () => {
    expect(resolveForecast(null)).toEqual(DEFAULT_FORECAST)
    expect(resolveForecast({ temp_odds: { hot: '70', warm: 'x' } }).temp_odds).toEqual({ hot: 70, warm: 30, cold: 10 })
  })
})

describe('helpers', () => {
  it('monthKeyOf with an offset', () => {
    expect(monthKeyOf(NOW)).toBe('2026-11')
    expect(monthKeyOf(NOW, 1)).toBe('2026-12')
  })
  it('average funded primary loan over the last 12 months, else all funded', () => {
    const loans = [
      loan({ id: 1, stage_group: 'funded', funded_on: '2026-06-01', amount: 300000 }),
      loan({ id: 2, stage_group: 'funded', funded_on: '2026-09-01', amount: 500000 }),
      loan({ id: 3, stage_group: 'funded', funded_on: '2026-09-01', amount: 900000, role: 'assisted' }),
      loan({ id: 4, stage_group: 'funded', funded_on: '2024-01-01', amount: 100000 }),
    ]
    expect(avgFundedLoan(loans, NOW)).toBe(400000)
    expect(avgFundedLoan([loan({ id: 5, stage_group: 'funded', funded_on: '2023-01-01', amount: 200000 })], NOW)).toBe(200000)
    expect(avgFundedLoan([], NOW)).toBe(null)
  })
  it('MPG per account: actual average, else the estimate, else null', () => {
    expect(mpgPerAccount({ residual: 900, merchants: 3 }, settings)).toEqual({ amount: 300, est: false })
    expect(mpgPerAccount({ residual: 0, merchants: 0 }, { ...settings, mpg_est_residual_per_account: 120 })).toEqual({ amount: 120, est: true })
    expect(mpgPerAccount({}, settings)).toBe(null)
  })
})

describe('forecastLines', () => {
  it('an Arive loan beats the rating on the same contact', () => {
    const lines = forecastLines({
      ratings: map(rating({ contact_id: 'c1' })),
      loans: [loan({ id: 9, contact_id: 'c1', firm_closing_on: '2026-11-20' })],
      rates, settings, avgLoan: 300000, mpgAccount: null, now: NOW,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ source: 'arive', payout: 5000, odds: 75, month: '2026-11', payDate: '2026-11-20' })
  })
  it('funded loans count at 100% in their funded month; adverse loans and scenarios are out', () => {
    const lines = forecastLines({
      ratings: new Map(),
      loans: [
        loan({ id: 1, stage_group: 'funded', funded_on: '2026-11-02' }),
        loan({ id: 2, stage_group: 'adverse' }),
        loan({ id: 3, scenario_auto: true, firm_closing_on: '2026-11-10' }),
      ],
      rates, settings, avgLoan: null, mpgAccount: null, now: NOW,
    })
    expect(lines.map((l) => [l.key, l.odds, l.funded])).toEqual([['loan:1', 100, true]])
  })
  it('a rated Bayway lead uses its amount, else the average loan, marked est.', () => {
    const lines = forecastLines({
      ratings: map(rating({ contact_id: 'a', est_amount: 200000 }), rating({ contact_id: 'b', temperature: 'warm' })),
      loans: [], rates, settings, avgLoan: 400000, mpgAccount: null, now: NOW,
    })
    expect(lines.find((l) => l.contactId === 'a')).toMatchObject({ payout: 2500, odds: 60, month: '2026-12', est: false })
    expect(lines.find((l) => l.contactId === 'b')).toMatchObject({ payout: 5000, odds: 30, month: '2027-01', est: true })
  })
  it('a rated MPG lead counts as an account, with dollars only when a per-account amount exists', () => {
    const base = { ratings: map(rating({ contact_id: 'm', business_id: 'mpg', close_month: '2026-11-01' })), loans: [], rates, settings, avgLoan: null, now: NOW }
    expect(forecastLines({ ...base, mpgAccount: null })[0]).toMatchObject({ book: 'mpg', payout: null, odds: 60, month: '2026-11' })
    expect(forecastLines({ ...base, mpgAccount: { amount: 150, est: true } })[0]).toMatchObject({ payout: 150, est: true })
  })
})

describe('forecastByMonth', () => {
  it('splits funded and weighted for Bayway, accounts or dollars for MPG', () => {
    const lines = [
      { book: 'bay', month: '2026-11', payout: 5000, odds: 100, funded: true, est: false },
      { book: 'bay', month: '2026-11', payout: 4000, odds: 75, funded: false, est: false },
      { book: 'bay', month: '2026-11', payout: 5000, odds: 60, funded: false, est: true },
      { book: 'bay', month: '2026-12', payout: 9999, odds: 60, funded: false, est: false },
      { book: 'mpg', month: '2026-11', payout: null, odds: 60, est: false },
      { book: 'mpg', month: '2026-11', payout: null, odds: 30, est: false },
    ]
    expect(forecastByMonth(lines, '2026-11')).toEqual({
      month: '2026-11',
      bay: { expected: 11000, funded: 5000, weighted: 6000, est: 1 },
      mpg: { expected: null, accounts: 0.9, est: 0 },
      total: 11000,
    })
  })
})

describe('sortPaysFirst', () => {
  it('earliest pay date first, then bigger expected payout; rows without a line last', () => {
    const lines = [
      { contactId: 'late', payDate: '2026-12-01', payout: 9000, odds: 60 },
      { contactId: 'soon-small', payDate: '2026-11-10', payout: 1000, odds: 60 },
      { contactId: 'soon-big', payDate: '2026-11-10', payout: 5000, odds: 60 },
    ]
    const rows = ['none', 'late', 'soon-small', 'soon-big'].map((id) => ({ id }))
    expect(sortPaysFirst(rows, lines).map((r) => r.id)).toEqual(['soon-big', 'soon-small', 'late', 'none'])
  })
})
