import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FORECAST, resolveForecast, monthKeyOf, avgFundedLoan, mpgPerAccount, forecastLines, forecastByMonth, sortPaysFirst, latestMpgMetrics,
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
      undated: { count: 0, weighted: 0 },
      total: 11000,
    })
  })
  it('undated unfunded lines are counted across all lines, not per month', () => {
    const lines = [
      { book: 'bay', month: null, payout: 4000, odds: 75, funded: false, est: false },
      { book: 'bay', month: null, payout: 1000, odds: 100, funded: true, est: false },
      { book: 'bay', month: '2026-12', payout: 2000, odds: 50, funded: false, est: false },
    ]
    const r = forecastByMonth(lines, '2026-11')
    expect(r.undated).toEqual({ count: 1, weighted: 3000 })
    expect(r.total).toBe(0)
    expect(forecastByMonth(lines, '2026-12').undated).toEqual({ count: 1, weighted: 3000 })
  })
  it('works end to end on forecastLines output', () => {
    const lines = forecastLines({
      ratings: map(rating({ contact_id: 'a', est_amount: 200000, close_month: '2026-11-01' })),
      loans: [
        loan({ id: 1, stage_group: 'funded', funded_on: '2026-11-02', amount: 400000 }),
        loan({ id: 2, stage_group: 'closing', firm_closing_on: '2026-11-25', amount: 400000 }),
      ],
      rates, settings, avgLoan: null, mpgAccount: null, now: NOW,
    })
    expect(forecastByMonth(lines, '2026-11')).toEqual({
      month: '2026-11',
      bay: { expected: 5000 + 4750 + 1500, funded: 5000, weighted: 6250, est: 0 },
      mpg: { expected: null, accounts: 0, est: 0 },
      undated: { count: 0, weighted: 0 },
      total: 11250,
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
  it('ignores funded lines, and on a tie keeps the larger weighted line', () => {
    const lines = [
      { contactId: 'repeat', payDate: '2024-03-01', payout: 9000, odds: 100, funded: true },
      { contactId: 'repeat', payDate: '2026-12-01', payout: 1000, odds: 60 },
      { contactId: 'other', payDate: '2026-11-15', payout: 1000, odds: 60 },
      { contactId: 'tie', payDate: '2026-11-20', payout: 100, odds: 60 },
      { contactId: 'tie', payDate: '2026-11-20', payout: 9000, odds: 60 },
      { contactId: 'tie2', payDate: '2026-11-20', payout: 3000, odds: 60 },
    ]
    const rows = ['repeat', 'other', 'tie', 'tie2'].map((id) => ({ id }))
    expect(sortPaysFirst(rows, lines).map((r) => r.id)).toEqual(['other', 'tie', 'tie2', 'repeat'])
  })
})

describe('resolveForecast bounds', () => {
  it('clamps odds, truncates offsets, treats blank strings as unset', () => {
    expect(resolveForecast({ temp_odds: { hot: 150, warm: -20, cold: ' ' } }).temp_odds).toEqual({ hot: 100, warm: 0, cold: 10 })
    expect(resolveForecast({ arive_odds: { prospect: 150 } }).arive_odds.prospect).toBe(100)
    expect(resolveForecast({ close_offset_months: { hot: 1.7, warm: -3, cold: ' ' } }).close_offset_months).toEqual({ hot: 1, warm: 0, cold: 3 })
    expect(resolveForecast({ temp_odds: { hot: ' 45 ' } }).temp_odds.hot).toBe(45)
  })
})

describe('avgFundedLoan scenarios', () => {
  it('ignores scenario loans', () => {
    const loans = [
      loan({ id: 1, stage_group: 'funded', funded_on: '2026-09-01', amount: 300000 }),
      loan({ id: 2, stage_group: 'funded', funded_on: '2026-09-01', amount: 900000, scenario_override: true }),
    ]
    expect(avgFundedLoan(loans, NOW)).toBe(300000)
  })
})

describe('forecastLines: deal identity, overdue, undated, bad data', () => {
  const run = (o) => forecastLines({ rates, settings, avgLoan: 400000, mpgAccount: null, now: NOW, loans: [], ratings: new Map(), ...o })

  it('a past client funded long ago, rated Hot now, counts the rating as a new deal', () => {
    const lines = run({
      ratings: map(rating({ contact_id: 'c', rated_at: '2026-11-01T12:00:00' })),
      loans: [loan({ id: 1, contact_id: 'c', stage_group: 'funded', funded_on: '2024-05-01' })],
    })
    expect(lines.map((l) => l.key).sort()).toEqual(['loan:1', 'rating:c'])
  })
  it('rated Hot, then the loan funds this month: only the funded loan counts', () => {
    const lines = run({
      ratings: map(rating({ contact_id: 'c', rated_at: '2026-10-15T12:00:00' })),
      loans: [loan({ id: 1, contact_id: 'c', stage_group: 'funded', funded_on: '2026-11-02' })],
    })
    expect(lines.map((l) => l.key)).toEqual(['loan:1'])
  })
  it('an adverse loan never hides a rating, whatever its dates (imports rewrite them)', () => {
    const r = map(rating({ contact_id: 'c', rated_at: '2026-11-03T08:00:00' }))
    const after = loan({ id: 2, contact_id: 'c', stage_group: 'adverse', updated_at: '2026-11-03T10:00:00', last_seen_at: '2026-11-03T10:00:00' })
    const undated = loan({ id: 3, contact_id: 'c', stage_group: 'adverse' })
    expect(run({ ratings: r, loans: [after] }).map((l) => l.key)).toEqual(['rating:c'])
    expect(run({ ratings: r, loans: [undated] }).map((l) => l.key)).toEqual(['rating:c'])
  })
  it('a scenario loan never hides a rating', () => {
    const lines = run({
      ratings: map(rating({ contact_id: 'c' })),
      loans: [loan({ id: 1, contact_id: 'c', scenario_auto: true, firm_closing_on: '2026-11-10' })],
    })
    expect(lines.map((l) => l.key)).toEqual(['rating:c'])
  })
  it('an unfunded line dated before this month moves into this month, flagged overdue', () => {
    const lines = run({
      ratings: map(rating({ contact_id: 'm', close_month: '2026-08-01' })),
      loans: [loan({ id: 1, firm_closing_on: '2026-10-20' }), loan({ id: 2, stage_group: 'funded', funded_on: '2026-10-20' })],
    })
    expect(lines.find((l) => l.key === 'loan:1')).toMatchObject({ month: '2026-11', overdue: true, payDate: '2026-10-20' })
    expect(lines.find((l) => l.key === 'rating:m')).toMatchObject({ month: '2026-11', overdue: true })
    expect(lines.find((l) => l.key === 'loan:2')).toMatchObject({ month: '2026-10', overdue: false })
  })
  it('an open loan with no closing date and no rating is undated', () => {
    const lines = run({ loans: [loan({ id: 1 })] })
    expect(lines[0]).toMatchObject({ month: null, payDate: null, overdue: false })
    expect(forecastByMonth(lines, '2026-11').undated).toEqual({ count: 1, weighted: 3750 })
  })
  it('an open loan with a rating but no firm closing date uses the rating close month', () => {
    const lines = run({
      ratings: map(rating({ contact_id: 'c', close_month: '2026-12-01' })),
      loans: [loan({ id: 1, contact_id: 'c' })],
    })
    expect(lines[0]).toMatchObject({ month: '2026-12', payDate: '2026-12-01' })
  })
  it('an assisted loan pays at the assisted rate', () => {
    const lines = run({ loans: [loan({ id: 1, role: 'assisted', firm_closing_on: '2026-11-20' })] })
    expect(lines[0].payout).toBe(3000)
  })
  it('unknown temperature or stage emits no line and no NaN', () => {
    const lines = run({
      ratings: map(rating({ contact_id: 'x', temperature: 'lukewarm' }), rating({ contact_id: 'y' })),
      loans: [loan({ id: 1, stage_group: 'mystery' })],
    })
    expect(lines.map((l) => l.key)).toEqual(['rating:y'])
    const totals = forecastByMonth(lines, '2026-12')
    expect(Number.isFinite(totals.total)).toBe(true)
    expect(Number.isFinite(totals.bay.expected)).toBe(true)
  })
  it('an unknown business id is skipped', () => {
    expect(run({ ratings: map(rating({ contact_id: 'z', business_id: 'other' })) })).toEqual([])
  })
})

describe('latestMpgMetrics', () => {
  it('takes the newest date that has both residual and merchants', () => {
    const rows = [
      { date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 900 },
      { date: '2026-10-01', metric_key: 'rev_monthly_residual', value: 800 },
      { date: '2026-10-01', metric_key: 'rev_active_merchants', value: 4 },
    ]
    expect(latestMpgMetrics(rows)).toEqual({ residual: 800, merchants: 4 })
  })
  it('is null/null with no shared date', () => {
    expect(latestMpgMetrics([{ date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 1 }])).toEqual({ residual: null, merchants: null })
  })
})
