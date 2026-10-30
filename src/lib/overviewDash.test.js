import { describe, it, expect } from 'vitest'
import {
  monthValues,
  kpiCards,
  activitySeries,
  activityChart,
  goalStatus,
  monthlyGoals,
  gaugeSegments,
  pipelineMix,
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

describe('monthValues and kpiCards', () => {
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

  it('builds commission, closed, calls and pipeline cards', () => {
    const cards = kpiCards({ biz: 'all', values: v, targets })
    expect(cards.map((c) => c.id)).toEqual(['commission', 'closed', 'calls', 'pipeline'])
    expect(cards[0]).toMatchObject({ value: 9800, goal: 17500, pct: 56, tag: 'Entered' })
    expect(cards[1]).toMatchObject({ value: 3, foot: 'Bayway 1 loans · MPG 2 merchants', delta: { text: '→ 0 vs Sep', tone: 'flat' } })
    expect(cards[2].delta).toEqual({ text: '↓ 43% vs Sep', tone: 'down' })
    expect(cards[2].foot).toBe('11 today')
    expect(cards[3]).toMatchObject({ value: 400000, foot: '1 open loan · Bayway' })
  })

  it('MPG view swaps in residual and open leads', () => {
    const mv = monthValues({ biz: 'mpg', metrics, deals, activities, pipeline, now: NOW })
    expect(mv.loansClosed).toBe(0)
    expect(mv.calls).toBe(1)
    const cards = kpiCards({ biz: 'mpg', values: mv, targets, mpgRows: [{ stage: 'Open' }, { stage: 'Qualified' }, { stage: 'Lost' }] })
    expect(cards.map((c) => c.id)).toEqual(['residual', 'closed', 'calls', 'open_leads'])
    expect(cards[3]).toMatchObject({ value: 2, delta: { text: '1 qualified' } })
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

  it('draws both lines on one scale with dated ticks', () => {
    const s = activitySeries({ activities, pipeline, deals, days: 30, now: NOW })
    const c = activityChart(s.points)
    expect(c.max).toBe(20)
    expect(c.act.startsWith('M 40 ')).toBe(true)
    expect(c.labels.at(-1).label).toBe('Today')
    expect(c.labels[0].label).toBe('Sep 28')
    expect(c.points).toHaveLength(30)
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
    expect(g.counts).toEqual({ hit: 0, pace: 0, behind: 5 })
    expect(g.onPace).toBe(0)
    expect(monthlyGoals({ biz: 'mpg', values: v, targets, now: NOW }).goals.map((x) => x.id)).toEqual(['calls', 'merchants', 'residual', 'proposals'])
  })

  it('splits the gauge by status with gaps', () => {
    const segs = gaugeSegments({ hit: 1, pace: 1, behind: 2 })
    expect(segs.map((s) => s.status)).toEqual(['hit', 'pace', 'behind'])
    expect(segs[0].dash).toBe('24.25 75.75')
    expect(segs[1].offset).toBe('-25.75')
    expect(gaugeSegments({ hit: 0, pace: 0, behind: 0 })).toEqual([])
  })
})

describe('pipeline mix, income, sprints', () => {
  it('counts stages in order and drops empty ones', () => {
    const m = pipelineMix([{ stage: 'Attempted' }, { stage: 'New Lead' }, { stage: 'New Lead' }, { stage: 'Other' }], ['New Lead', 'Attempted', 'Contacted/Working'])
    expect(m.total).toBe(3)
    expect(m.slices.map((s) => [s.stage, s.n])).toEqual([['New Lead', 2], ['Attempted', 1]])
    expect(m.slices[1].offset).toBeCloseTo(-66.67, 1)
  })

  it('income mix against the combined goal', () => {
    const i = incomeMix({ values: { commission: 9800, residual: 4200 }, targets })
    expect(i).toMatchObject({ total: 14000, goal: 27500, pct: 51, annualized: 168000 })
  })

  it('sprint pace per book', () => {
    const rows = [{ date: '2026-08-10', business_id: 'bay', metric_key: 'bay_funded_loans', value: 10 }]
    const s = sprintPace({ biz: 'bay', metrics: rows, targets, now: NOW })
    expect(s.items.map((x) => x.key)).toEqual(['bay_funded_loans', 'bay_completed_applications'])
    expect(s.items[0]).toMatchObject({ value: 10, target: 10, onPace: true })
    expect(s.items[1].onPace).toBe(false)
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
    const cards = kpiCards({ biz: 'bay', values: v, targets })
    expect(cards[0]).toMatchObject({ value: 13800, tag: 'Est. from Arive' })
  })

  it('falls back to the old sources without an import', () => {
    const v = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW, loanStats: null })
    expect(v).toMatchObject({ commission: 9800, commissionFromArive: false })
    expect(kpiCards({ biz: 'bay', values: v, targets })[0].tag).toBe('Entered')
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
