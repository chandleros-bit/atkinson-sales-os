import { describe, it, expect } from 'vitest'
import { heatLevel, heatmap, countByDay, bayOutcome, mpgOutcome, sourceTable } from './analytics'

// 2026-10-28 is a Wednesday.
const NOW = new Date('2026-10-28T15:00:00').getTime()

describe('heatLevel', () => {
  it('shades by share of the busiest day', () => {
    expect([0, 10, 30, 60, 80, 100].map((n) => heatLevel(n, 100))).toEqual([0, 1, 2, 3, 4, 4])
  })
  it('without a peak any calls are full strength', () => {
    expect(heatLevel(3, 0)).toBe(4)
  })
})

describe('heatmap', () => {
  it('Monday-first weeks ending this week; future days marked', () => {
    const h = heatmap({}, { weeks: 2, now: NOW })
    expect(h.weeks).toHaveLength(2)
    expect(h.weeks[0][0].key).toBe('2026-10-19')
    expect(h.weeks[1][0].key).toBe('2026-10-26')
    expect(h.weeks[1][2]).toMatchObject({ key: '2026-10-28', future: false })
    expect(h.weeks[1][3]).toMatchObject({ key: '2026-10-29', future: true, level: null })
  })
  it('counts, levels against the peak, and stats; a month label where a month starts', () => {
    // 10-30 is in the future and 09-01 before the grid: neither sets the peak.
    const h = heatmap({ '2026-10-26': 120, '2026-10-27': 40, '2026-10-20': 20, '2026-10-30': 999, '2026-09-01': 999 }, { weeks: 2, goal: 100, now: NOW })
    expect(h.weeks[1].slice(0, 3).map((c) => c.level)).toEqual([4, 2, 0])
    expect(h.weeks[0][1].level).toBe(1)
    expect(h.stats).toEqual({ total: 180, active: 3, avg: 60, best: { key: '2026-10-26', count: 120 }, atGoal: 1 })
    expect(h.months).toEqual([{ col: 0, label: 'Oct' }])
  })
})

describe('countByDay', () => {
  it('counts rows per local day', () => {
    expect(countByDay([{ occurred_at: '2026-10-27T09:00:00' }, { occurred_at: '2026-10-27T17:00:00' }, { occurred_at: null }])).toEqual({ '2026-10-27': 2 })
  })
})

describe('bayOutcome', () => {
  const lead = (tags, person_stage = 'Lead') => ({ tags, person_stage })
  it('reads the board column from the FUB tags', () => {
    expect(bayOutcome(lead([]))).toBe('new')
    expect(bayOutcome(lead(['attempted']))).toBe('new')
    expect(bayOutcome(lead(['Working Estimate']))).toBe('working')
    expect(bayOutcome(lead(['estimate sent']))).toBe('app')
    expect(bayOutcome(lead([], 'Pre-Qualified'))).toBe('received')
    expect(bayOutcome(lead(['Lost', 'estimate sent']))).toBe('lost')
    expect(bayOutcome(lead(['Credit Repair']))).toBe('nurture')
  })
  it('closed and off-board person stages', () => {
    expect(bayOutcome(lead([], 'Closed'))).toBe('closed')
    expect(bayOutcome(lead([], 'Past Client'))).toBe('closed')
    expect(bayOutcome(lead([], 'Trash'))).toBe('lost')
    expect(bayOutcome(lead([], 'Nurture'))).toBe('nurture')
    expect(bayOutcome(lead([], 'Sphere'))).toBe('other')
  })
})

describe('mpgOutcome', () => {
  it('reads the Zoho lead status', () => {
    expect(['Not Contacted', 'Contacted', 'Qualified', 'Junk Lead', 'Weird'].map((s) => mpgOutcome({ person_stage: s }))).toEqual([
      'new',
      'contacted',
      'qualified',
      'lost',
      'other',
    ])
  })
})

describe('sourceTable', () => {
  const from = new Date('2026-08-01T00:00:00').getTime()
  const bay = (source, tags, created = '2026-09-10T12:00:00', person_stage = 'Lead') => ({ business_id: 'bay', source, tags, created, person_stage })
  it('groups leads in the window by source, biggest first, with rates and a total', () => {
    const rows = [
      bay('LendingFlow', ['estimate sent']),
      bay('LendingFlow', []),
      bay('LendingFlow', ['Lost']),
      bay('PML', [], '2026-09-01T12:00:00', 'Pre-Qualified'),
      bay('PML', [], '2026-06-01T12:00:00'), // before the window
      bay('<unspecified>', ['Working Estimate']),
      bay('Agent', [], '2026-09-01T12:00:00', 'Realtors'), // a partner, not a lead
      { business_id: 'mpg', source: 'Web', created: '2026-09-01T12:00:00', person_stage: 'Contacted' },
    ]
    const t = sourceTable(rows, 'bay', from)
    expect(t.cols.map((c) => c.id)).toEqual(['contacted', 'apps', 'received', 'lost'])
    expect(t.rows.map((r) => [r.source, r.leads, r.rate])).toEqual([
      ['LendingFlow', 3, 33],
      ['No source', 1, 0],
      ['PML', 1, 100],
    ])
    expect(t.rows[0].counts).toEqual({ contacted: 1, apps: 1, lost: 1 })
    expect(t.total).toMatchObject({ leads: 5, rate: 40, counts: { contacted: 3, apps: 2, received: 1, lost: 1 } })
  })
  it('MPG uses qualified for the rate', () => {
    const t = sourceTable([{ business_id: 'mpg', source: 'Web', created: '2026-09-01T12:00:00', person_stage: 'Qualified' }], 'mpg', from)
    expect(t.total).toMatchObject({ leads: 1, rate: 100 })
  })
})
