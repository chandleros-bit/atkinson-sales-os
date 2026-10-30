import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RATES, resolveRates, isScenario, isOpen, estComp, notInLatest, filterLoans,
  pipelineStatus, lenderSpread, fundedByMonth, loanStats, hasApplicationDates, periodWindow, inPeriod,
} from './loans'

const L = (o) => ({ role: 'primary', amount: 100000, stage: 'App Intake', stage_group: 'prospect', scenario_auto: false, scenario_override: null, comp_override: null, ...o })
const rates = resolveRates(null)

describe('rates and per-loan values', () => {
  it('fills defaults and ignores junk', () => {
    expect(DEFAULT_RATES).toEqual({ lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 })
    expect(resolveRates({ primary_pct: 1.5, calls: 100 })).toEqual({ ...DEFAULT_RATES, primary_pct: 1.5 })
  })
  it('estimates commission by role, with an override winning', () => {
    expect(estComp(L({ amount: 400000 }), rates)).toBe(5000)
    expect(estComp(L({ amount: 400000, role: 'assisted' }), rates)).toBe(3000)
    expect(estComp(L({ amount: 400000, comp_override: 4200 }), rates)).toBe(4200)
    expect(estComp(L({ amount: null }), rates)).toBeNull()
  })
  it('lets the manual scenario toggle beat the auto flag', () => {
    expect(isScenario(L({ scenario_auto: true }))).toBe(true)
    expect(isScenario(L({ scenario_auto: true, scenario_override: false }))).toBe(false)
    expect(isScenario(L({ scenario_override: true }))).toBe(true)
  })
  it('knows open loans and stale ones', () => {
    expect(isOpen(L({ stage_group: 'closing' }))).toBe(true)
    expect(isOpen(L({ stage_group: 'funded' }))).toBe(false)
    expect(notInLatest(L({ last_seen_at: '2026-10-01T00:00:00Z' }), '2026-10-30T00:00:00Z')).toBe(true)
    expect(notInLatest(L({ last_seen_at: '2026-10-30T00:00:00Z' }), '2026-10-30T00:00:00Z')).toBe(false)
    expect(notInLatest(L({ last_seen_at: '2026-10-01T00:00:00Z' }), null)).toBe(false)
  })
  it('compares last_seen_at as instants, not strings', () => {
    expect(notInLatest(L({ last_seen_at: '2026-10-30T00:00:00+00:00' }), '2026-10-30T00:00:00Z')).toBe(false)
  })
})

describe('filterLoans', () => {
  const loans = [L({ id: 1 }), L({ id: 2, role: 'assisted' }), L({ id: 3, scenario_auto: true })]
  it('hides scenarios unless asked and filters by role', () => {
    expect(filterLoans(loans, { role: 'all', scenarios: false }).map((l) => l.id)).toEqual([1, 2])
    expect(filterLoans(loans, { role: 'all', scenarios: true }).map((l) => l.id)).toEqual([1, 2, 3])
    expect(filterLoans(loans, { role: 'assisted', scenarios: false }).map((l) => l.id)).toEqual([2])
    expect(filterLoans(loans, { role: 'primary', scenarios: false }).map((l) => l.id)).toEqual([1])
  })
})

describe('panels', () => {
  const loans = [
    L({ stage: 'App Intake', amount: 200000 }),
    L({ stage: 'App Intake', amount: null }),
    L({ stage: 'Clear To Close', stage_group: 'closing', amount: 600000 }),
    L({ stage: 'Loan Finalized', stage_group: 'funded', amount: 250000, lender: 'UWM', purpose: 'Purchase', funded_on: '2026-10-05' }),
    L({ stage: 'Loan Funded', stage_group: 'funded', amount: 650000, lender: 'TLS', purpose: 'Purchase', funded_on: '2026-10-29' }),
    L({ stage: 'Loan Finalized', stage_group: 'funded', amount: 200000, lender: 'Cardinal Financial', purpose: 'Refinance', funded_on: '2026-09-09' }),
    L({ stage: 'Loan Funded', stage_group: 'funded', amount: 100000, lender: 'Newfi', purpose: 'Purchase', funded_on: '2026-08-01' }),
    L({ stage: 'Loan Funded', stage_group: 'funded', amount: 90000, lender: 'Newfi', purpose: 'Purchase', funded_on: '2025-12-01' }),
    L({ stage: 'Mystery', stage_group: 'other', amount: 5 }),
  ]

  it('pipelineStatus groups every stage in order, zeros included', () => {
    const groups = pipelineStatus(loans)
    expect(groups.map((g) => g.key)).toEqual(['prospect', 'processing', 'closing', 'funded', 'adverse', 'other'])
    expect(groups[0].rows[0]).toEqual({ stage: 'App Intake', count: 2, amount: 200000 })
    expect(groups[1].rows.every((r) => r.count === 0)).toBe(true)
    expect(groups[3].rows.find((r) => r.stage === 'Loan Funded')).toEqual({ stage: 'Loan Funded', count: 3, amount: 840000 })
    expect(groups[5].rows).toEqual([{ stage: 'Mystery', count: 1, amount: 5 }])
  })

  it('pipelineStatus counts a stage with extra spaces or different case in its row', () => {
    const groups = pipelineStatus([L({ stage: 'Approved w/  Conditions', stage_group: 'processing', amount: 7 }), L({ stage: 'app intake' })])
    expect(groups[1].rows.find((r) => r.stage === 'Approved w/ Conditions')).toEqual({ stage: 'Approved w/ Conditions', count: 1, amount: 7 })
    expect(groups[0].rows[0]).toEqual({ stage: 'App Intake', count: 1, amount: 100000 })
  })

  it('pipelineStatus labels a blank stage (blank) in the other group', () => {
    const other = pipelineStatus([L({ stage: null, stage_group: 'other', amount: 9 })]).find((g) => g.key === 'other')
    expect(other.rows).toEqual([{ stage: '(blank)', count: 1, amount: 9 }])
  })

  it('pipelineStatus drops the other group when empty', () => {
    expect(pipelineStatus([L({})]).map((g) => g.key)).not.toContain('other')
  })

  it('lenderSpread names the top three and folds the rest into Others', () => {
    const s = lenderSpread(loans, { from: '2026-01-01', to: '2027-01-01' })
    expect(s).toEqual({
      total: 4,
      rows: [
        { lender: 'Cardinal Financial', count: 1 },
        { lender: 'Newfi', count: 1 },
        { lender: 'TLS', count: 1 },
        { lender: 'Others', count: 1 },
      ],
    })
  })

  it('fundedByMonth counts a year by funded_on, split by purpose', () => {
    const f = fundedByMonth(loans, 2026)
    expect(f.count).toBe(4)
    expect(f.volume).toBe(1200000)
    expect(f.purchase).toEqual({ count: 3, volume: 1000000 })
    expect(f.refinance).toEqual({ count: 1, volume: 200000 })
    expect(f.months[9]).toEqual({ month: 9, count: 2, volume: 900000 })
    expect(f.months).toHaveLength(12)
  })

  it('hasApplicationDates is false until any loan has one', () => {
    expect(hasApplicationDates(loans)).toBe(false)
    expect(hasApplicationDates([L({ application_on: '2026-02-01' })])).toBe(true)
  })
})

describe('loanStats', () => {
  const win = { month: { from: '2026-10-01', to: '2026-11-01' }, prev: { from: '2026-09-01', to: '2026-10-01' }, sprint: { from: '2026-08-01', to: '2026-11-01' } }
  it('returns null with no loans', () => {
    expect(loanStats([], rates, win)).toBeNull()
  })
  it('counts funded loans, volume, commission and open pipeline without scenarios', () => {
    const loans = [
      L({ stage_group: 'funded', funded_on: '2026-10-05', amount: 400000 }),
      L({ stage_group: 'funded', funded_on: '2026-10-20', amount: 200000, role: 'assisted' }),
      L({ stage_group: 'funded', funded_on: '2026-09-15', amount: 300000 }),
      L({ stage_group: 'closing', amount: 500000 }),
      L({ stage_group: 'adverse', amount: 999 }),
      L({ stage_group: 'prospect', amount: 700000, scenario_auto: true }),
    ]
    expect(loanStats(loans, rates, win)).toEqual({
      closed: 2, closedPrev: 1, volume: 600000, commission: 6500, pipeline: 500000, open: 1, sprintFunded: 3,
    })
  })
})

describe('periods', () => {
  const now = new Date(2026, 9, 30, 15, 0).getTime() // local Oct 30 2026

  it('periodWindow builds local YYYY-MM-DD windows', () => {
    expect(periodWindow('ytd', now)).toEqual({ from: '2026-01-01', to: '2026-10-31' })
    expect(periodWindow('month', now)).toEqual({ from: '2026-10-01', to: '2026-11-01' })
    expect(periodWindow('year', now)).toEqual({ from: '2026-01-01', to: '2027-01-01' })
    expect(periodWindow('now', now)).toBeNull()
  })

  it('periodWindow YTD rolls over month and year ends', () => {
    expect(periodWindow('ytd', new Date(2026, 11, 31).getTime())).toEqual({ from: '2026-01-01', to: '2027-01-01' })
    expect(periodWindow('ytd', new Date(2026, 1, 28).getTime())).toEqual({ from: '2026-01-01', to: '2026-03-01' })
  })

  it('inPeriod keeps loans whose field falls in the window; no window keeps all', () => {
    const ls = [L({ id: 'a', application_on: '2026-10-02' }), L({ id: 'b', application_on: '2026-03-01' }), L({ id: 'c' })]
    expect(inPeriod(ls, 'application_on', { from: '2026-10-01', to: '2026-11-01' }).map((l) => l.id)).toEqual(['a'])
    expect(inPeriod(ls, 'application_on', { from: '2026-01-01', to: '2026-10-31' }).map((l) => l.id)).toEqual(['a', 'b'])
    expect(inPeriod(ls, 'application_on', null)).toBe(ls)
  })
})
