import { describe, it, expect } from 'vitest'
import { buildOwnerBriefing } from './briefing'

// Wed Nov 4 2026, 7:30 AM CST. Data timestamps sit mid-day UTC so the test
// passes in any TZ.
const NOW = new Date('2026-11-04T13:30:00Z').getTime()
const iso = (s) => new Date(s).toISOString()

const base = () => ({
  rules: null,
  targets: { calls: 100, applications: 10 },
  rates: { primary_pct: 1.25, assisted_pct: 0.75 },
  forecastSettings: null,
  metrics: [],
  deals: [],
  activities: [
    { occurred_at: iso('2026-11-03T16:00:00Z'), type: 'call', business_id: 'bay' },
    { occurred_at: iso('2026-11-02T16:00:00Z'), type: 'call', business_id: 'mpg' },
  ],
  yesterdayActivities: [
    { type: 'call', direction: 'outbound', raw: { outcome: 'Interested' } },
    { type: 'call', direction: 'outbound', raw: { outcome: 'No Answer' } },
  ],
  pipeline: [
    { id: 'p1', business_id: 'bay', name: 'Ann App', stage: 'Application Received', stage_since: iso('2026-11-03T15:00:00Z'), open_task_count: 0, docs_outstanding_count: 0 },
  ],
  loans: [
    { id: 1, borrower_name: 'Cal Close', role: 'primary', amount: 400000, stage_group: 'closing', firm_closing_on: '2026-11-06', funded_on: null, contact_id: null, comp_override: null, scenario_auto: false, scenario_override: null },
  ],
  ratings: [],
  signals: [
    { id: 's1', business_id: 'bay', name: 'Rita Reply', stage: 'Contacted/Working', is_active: true, last_inbound_at: iso('2026-11-03T20:00:00Z'), last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-11-10T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z') },
    { id: 's2', business_id: 'mpg', name: 'Oscar Overdue', stage: 'Pending', is_active: true, last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-11-01T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z') },
  ],
  dialRows: [],
  dialSkips: [],
  mpgTasks: [],
  workItems: [],
  events: [{ id: 'e1', source_account: 'mpg', title: 'Deli review', starts_at: iso('2026-11-04T16:00:00Z'), is_all_day: false }],
  syncLatest: {
    fub: { ran_at: iso('2026-11-04T13:28:00Z'), status: 'ok' },
    zoho: { ran_at: iso('2026-11-04T13:15:00Z'), status: 'ok' },
    'outlook-mpg': { ran_at: iso('2026-11-04T13:15:00Z'), status: 'error' },
    'outlook-bayway': { ran_at: iso('2026-11-04T13:15:00Z'), status: 'ok' },
  },
})

describe('buildOwnerBriefing', () => {
  it('builds every section from the app logic', () => {
    const b = buildOwnerBriefing(base(), NOW)
    expect(b.dateLabel).toBe('Wed Nov 4')
    // Goals: calls and applications are targeted; commission and residual are never listed.
    expect(b.numbers.goals.map((g) => g.id)).toEqual(expect.arrayContaining(['calls', 'applications']))
    expect(b.numbers.goals.map((g) => g.id)).not.toContain('commission')
    expect(b.numbers.goals.map((g) => g.id)).not.toContain('residual')
    expect(b.numbers.goals.find((g) => g.id === 'calls').needPerDay).toBeGreaterThan(0)
    expect(b.numbers.scorecard).toEqual({ calls: 2, connects: 1, texts: 0, applications: 1 })
    // Closing Friday at 95% of 400,000 x 1.25% = 4,750 this month.
    expect(b.today.closings).toEqual({ count: 1, top: [{ name: 'Cal Close', date: '2026-11-06' }] })
    expect(b.numbers.forecast.expected).toBe(4750)
    expect(b.today.meetings).toHaveLength(1)
    expect(b.today.meetings[0]).toMatchObject({ title: 'Deli review', book: 'mpg' })
    expect(b.callFirst.replied.top.map((r) => r.name)).toEqual(['Rita Reply'])
    expect(b.callFirst.overdue.top.map((r) => r.name)).toEqual(['Oscar Overdue'])
    expect(b.slipping.syncProblems.map((s) => s.label)).toEqual(['Outlook MPG'])
    expect(b.callFirstCount).toBe(2)
    expect(b.nothingSlipping).toBe(false)
  })

  it('caps every list at five but keeps the full count', () => {
    const d = base()
    d.signals = Array.from({ length: 8 }, (_, i) => ({
      id: `o${i}`, business_id: 'mpg', name: `Lead ${i}`, stage: 'Pending', is_active: true,
      last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-10-30T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z'),
    }))
    const b = buildOwnerBriefing(d, NOW)
    expect(b.callFirst.overdue.count).toBe(8)
    expect(b.callFirst.overdue.top).toHaveLength(5)
  })

  it('reports nothing slipping on a quiet day', () => {
    const d = base()
    d.syncLatest['outlook-mpg'].status = 'ok'
    const b = buildOwnerBriefing(d, NOW)
    expect(b.nothingSlipping).toBe(true)
  })
})
