import { describe, it, expect } from 'vitest'
import {
  monthValues,
  activitySeries,
  goalStatus,
  monthlyGoals,
  goalRows,
  mpgSubmittedThisMonth,
  mpgApprovedThisMonth,
  incomeMix,
  sprintPace,
  monthElapsed,
  fmtMoney,
  fundedLoanDeals,
} from './overviewDash'
import { DEFAULT_TARGETS } from './reports'

// Local times. 2026-10-27 is a Tuesday; October has 31 days.
const NOW = new Date('2026-10-27T10:00:00').getTime()
const at = (key, hh = 12) => new Date(`${key}T${String(hh).padStart(2, '0')}:00:00`).toISOString()
const targets = DEFAULT_TARGETS

const metrics = [
  { date: '2026-10-01', business_id: 'bay', metric_key: 'rev_gross_commission', value: 9800 },
  { date: '2026-10-01', business_id: 'mpg', metric_key: 'rev_monthly_residual', value: 4200 },
  { date: '2026-10-01', business_id: 'mpg', metric_key: 'new_merchant_accounts', value: 2 },
  { date: '2026-09-01', business_id: 'mpg', metric_key: 'new_merchant_accounts', value: 1 },
  { date: '2026-10-27', business_id: 'bay', metric_key: 'calls', value: 10 },
  { date: '2026-09-10', business_id: 'bay', metric_key: 'calls', value: 20 },
]
const deals = [
  { status: 'won', value: 300000, expected_close: '2026-10-09', business_id: 'bay' },
  { status: 'won', value: 250000, expected_close: '2026-09-15', business_id: 'bay' },
  { status: 'won', value: 250000, expected_close: '2026-09-20', business_id: 'bay' },
  { status: 'open', value: 400000, expected_close: null, business_id: 'bay' },
]
const activities = [
  { occurred_at: at('2026-10-27', 9), type: 'call', business_id: 'bay' },
  { occurred_at: at('2026-10-20'), type: 'call', business_id: 'mpg' },
  { occurred_at: at('2026-10-20'), type: 'text', business_id: 'bay' },
  { occurred_at: at('2026-09-05'), type: 'call', business_id: 'bay' },
  { occurred_at: at('2026-09-29'), type: 'call', business_id: 'bay' },
]
const pipeline = [
  { stage: 'Application Received', stage_since: at('2026-10-20') },
  { stage: 'Application/Estimate Sent', stage_since: at('2026-10-22') },
  { stage: 'Contacted/Working', stage_since: at('2026-10-22') },
  { stage: 'Application Received', stage_since: at('2026-09-02') },
]

describe('monthValues', () => {
  const v = monthValues({ biz: 'all', metrics, deals, activities, pipeline, now: NOW })

  it('adds up the month for both books', () => {
    expect(v).toMatchObject({
      commission: 9800, residual: 4200, loansClosed: 1, loansClosedPrev: 2, merchants: 2, merchantsPrev: 1,
      applications: 2, pipelineValue: 400000, openLoans: 1, prevMonthLabel: 'Sep',
    })
    // 10 entered + 2 synced this month; last month up to the 27th: 20 + 1 synced.
    expect(v.calls).toBe(12)
    expect(v.callsPrevSoFar).toBe(21)
    expect(v.callsToday).toBe(11)
  })

  it('MPG view leaves Bayway out', () => {
    const mv = monthValues({ biz: 'mpg', metrics, deals, activities, pipeline, now: NOW })
    expect(mv.loansClosed).toBe(0)
    expect(mv.calls).toBe(1)
  })
})

describe('activity and production', () => {
  it('counts touchpoints and production per day, with the window before', () => {
    const s = activitySeries({ activities, pipeline, deals, days: 30, now: NOW })
    expect(s.points).toHaveLength(30)
    expect(s.points[29]).toMatchObject({ key: '2026-10-27', touch: 1, calls: 1 })
    const oct20 = s.points.find((p) => p.key === '2026-10-20')
    expect(oct20).toMatchObject({ touch: 2, calls: 1, apps: 1, prod: 1 })
    expect(s.points.find((p) => p.key === '2026-10-09')).toMatchObject({ closings: 1, prod: 1 })
    expect(s.totals).toEqual({ touch: 4, calls: 3, apps: 2, closings: 1 })
    expect(s.prev).toEqual({ touch: 1, calls: 1, apps: 1, closings: 2 })
  })
})

describe('monthly goals', () => {
  it('hit, on pace or behind against the share of the month gone', () => {
    expect(monthElapsed(NOW)).toBeCloseTo(27 / 31)
    expect(goalStatus(5, 5, 0.5)).toBe('hit')
    expect(goalStatus(3, 5, 0.5)).toBe('pace')
    expect(goalStatus(1, 5, 0.5)).toBe('behind')
  })

  it('lists the visible books goals and the share on pace', () => {
    const v = monthValues({ biz: 'all', metrics, deals, activities, pipeline, now: NOW })
    const g = monthlyGoals({ biz: 'all', values: v, targets, now: NOW })
    expect(g.goals.map((x) => x.id)).toEqual(['calls', 'closings', 'commission', 'applications', 'merchants'])
    expect(g.counts).toEqual({ hit: 1, pace: 0, behind: 4 })
    expect(g.onPace).toBe(20)
    expect(monthlyGoals({ biz: 'mpg', values: v, targets, now: NOW }).goals.map((x) => x.id)).toEqual(['calls', 'merchants', 'residual', 'proposals'])
  })
})

describe('income, sprints', () => {
  it('income mix against the combined goal', () => {
    const i = incomeMix({ values: { commission: 9800, residual: 4200 }, targets })
    expect(i).toMatchObject({ total: 14000, goal: 7750, pct: 100, annualized: 168000 })
  })

  it('sprint pace per book', () => {
    const rows = [{ date: '2026-08-10', business_id: 'bay', metric_key: 'bay_funded_loans', value: 10 }]
    const s = sprintPace({ biz: 'bay', metrics: rows, targets, now: NOW })
    expect(s.items.map((x) => x.key)).toEqual(['bay_funded_loans', 'bay_completed_applications'])
    expect(s.items[0]).toMatchObject({ value: 10, target: 10, onPace: true })
    expect(s.items[1].onPace).toBe(false)
    expect(s.ended).toBe(false)
  })

  it('a sprint past its window is ended and judged hit or missed', () => {
    const rows = [{ date: '2026-08-10', business_id: 'bay', metric_key: 'bay_funded_loans', value: 10 }]
    const s = sprintPace({ biz: 'bay', metrics: rows, targets, now: new Date('2026-11-07T10:00:00').getTime() })
    expect(s.ended).toBe(true)
    expect(s.weeksLeft).toBe(0)
    expect(s.items.map((x) => x.hit)).toEqual([true, false])
  })

  it('formats money compactly', () => {
    expect(fmtMoney(17500)).toBe('$17.5K')
    expect(fmtMoney(2_000_000)).toBe('$2M')
    expect(fmtMoney(640)).toBe('$640')
  })
})

describe('Arive loan stats on Overview', () => {
  const loanStats = { closed: 3, closedPrev: 1, volume: 1104233, commission: 13800, pipeline: 900000, open: 4, sprintFunded: 5 }

  it('uses the loan stats instead of FUB deals and entered commission', () => {
    const v = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW, loanStats })
    expect(v).toMatchObject({ commission: 13800, loansClosed: 3, loansClosedPrev: 1, pipelineValue: 900000, openLoans: 4, commissionFromArive: true })
  })

  it('falls back to the old sources without an import', () => {
    const v = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW, loanStats: null })
    expect(v).toMatchObject({ commission: 9800, commissionFromArive: false })
  })

  it('sprint pace takes measured funded loans', () => {
    const s = sprintPace({ biz: 'bay', metrics: [], targets, now: NOW, measured: { bay_funded_loans: 5 } })
    expect(s.items.find((x) => x.key === 'bay_funded_loans').value).toBe(5)
  })
})

describe('Arive loans on the activity chart and income card', () => {
  const loans = [
    { id: 'a', amount: 400000, funded_on: '2026-10-20', scenario_auto: false, scenario_override: null },
    { id: 'b', amount: 300000, funded_on: '2026-10-21', scenario_auto: true, scenario_override: null },
    { id: 'c', amount: 250000, funded_on: '2026-10-22', scenario_auto: true, scenario_override: false },
    { id: 'd', amount: 500000, funded_on: null, scenario_auto: false, scenario_override: null },
  ]

  it('funded, non-scenario loans become won Bayway deals', () => {
    expect(fundedLoanDeals(loans)).toEqual([
      { status: 'won', value: 400000, expected_close: '2026-10-20', business_id: 'bay' },
      { status: 'won', value: 250000, expected_close: '2026-10-22', business_id: 'bay' },
    ])
  })

  it('feeds the closings series', () => {
    const s = activitySeries({ deals: fundedLoanDeals(loans), now: NOW })
    expect(s.totals.closings).toBe(2)
    expect(s.points.find((p) => p.key === '2026-10-21').closings).toBe(0)
  })

  it('income mix says where commission came from', () => {
    const fromArive = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW, loanStats: { closed: 1, closedPrev: 0, volume: 1, commission: 5000, pipeline: 0, open: 0, sprintFunded: 0 } })
    expect(incomeMix({ values: fromArive, targets }).fromArive).toBe(true)
    const entered = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW })
    expect(incomeMix({ values: entered, targets }).fromArive).toBe(false)
  })
})

describe('November goals (redesign A3)', () => {
  // Nov 15 of 30: half the month gone.
  const NOW15 = new Date('2026-11-15T10:00:00').getTime()
  const targets = { calls_monthly: 500, applications: 12, loans_closed: 5, merchant_proposals_delivered: 10, new_merchant_accounts: 3 }
  const values = { calls: 300, applications: 4, loansClosed: 1, merchants: 0 }

  it('shows five rows in All, with pace words and facts', () => {
    const g = goalRows({ biz: 'all', values, targets, extra: { proposals: 5, closing: 2, approved: 0 }, now: NOW15 })
    expect(g.rows.map((r) => r.id)).toEqual(['calls', 'applications', 'funded', 'proposals', 'accounts'])
    const by = Object.fromEntries(g.rows.map((r) => [r.id, r]))
    expect(by.calls.word).toBe('On pace')
    expect(by.proposals.word).toBe('On pace')
    expect(by.applications.word).toBe('Behind')
    // 1 funded + 2 closing covers 2.5 expected by mid-month.
    expect(by.funded.word).toBe('2 closing')
    expect(by.accounts.word).toBe('Behind')
    // Accounts (0 of 1.5 expected) is further behind than apps (4 of 6).
    expect(g.behind.id).toBe('accounts')
    expect(g.daysLeft).toBe(15)
  })

  it('drops the other book and says Hit at target', () => {
    const bay = goalRows({ biz: 'bay', values: { ...values, applications: 12 }, targets, now: NOW15 })
    expect(bay.rows.map((r) => r.id)).toEqual(['calls', 'applications', 'funded'])
    expect(bay.rows[1].word).toBe('Hit')
    const mpg = goalRows({ biz: 'mpg', values, targets, extra: { proposals: 5 }, now: NOW15 })
    expect(mpg.rows.map((r) => r.id)).toEqual(['calls', 'proposals', 'accounts'])
  })

  it('counts MPG submitted and approved this month from Zoho stages', () => {
    const rows = [
      { id: 1, stage: 'Submitted', stage_since: '2026-11-03T15:00:00Z' },
      { id: 2, stage: 'Approved', stage_since: '2026-11-10T15:00:00Z' },
      { id: 3, stage: 'Submitted', stage_since: '2026-10-28T15:00:00Z' },
      { id: 4, stage: 'Open', stage_since: '2026-11-05T15:00:00Z' },
    ]
    expect(mpgSubmittedThisMonth(rows, NOW15)).toBe(2)
    expect(mpgApprovedThisMonth(rows, NOW15)).toEqual([2])
  })
})
