import { describe, it, expect } from 'vitest'
import { filterRows, sortRows, pipelineKpis, leadSource } from './pipelineView'
import { DEFAULT_RULES } from './priorityQueue'

// Local times (no Z). 2026-10-18 is a Sunday.
const NOW = new Date('2026-10-18T09:00:00').getTime()
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}
const rules = DEFAULT_RULES
const row = (id, o = {}) => ({ id, name: id, stage: 'Attempted', stage_since: null, open_task_count: 0, oldest_open_due_at: null, last_touch_at: null, ...o })

describe('filterRows', () => {
  const rows = [
    row('a', { name: 'Ana Ruiz', email: 'ana@x.co', phone: '(713) 555-0142' }),
    row('b', { name: 'Bo', company: 'Pita Co', phone: '2815550195' }),
  ]
  it('everything for an empty query', () => {
    expect(filterRows(rows, '  ')).toBe(rows)
  })
  it('name, company and email, any case', () => {
    expect(filterRows(rows, 'RUIZ').map((r) => r.id)).toEqual(['a'])
    expect(filterRows(rows, 'pita').map((r) => r.id)).toEqual(['b'])
    expect(filterRows(rows, 'ana@').map((r) => r.id)).toEqual(['a'])
  })
  it('lead source, any case', () => {
    const withSource = [...rows, row('c', { name: 'Cy', lead_source: 'LendingFlow' })]
    expect(filterRows(withSource, 'lendingflow').map((r) => r.id)).toEqual(['c'])
  })
  it('phone by digits once there are three', () => {
    expect(filterRows(rows, '555-0195').map((r) => r.id)).toEqual(['b'])
    expect(filterRows(rows, '55').map((r) => r.id)).toEqual([])
  })
})

describe('sortRows', () => {
  const rows = [
    row('late', { name: 'Zed', open_task_count: 1, oldest_open_due_at: daysAgo(3), last_touch_at: daysAgo(1), crm_created_at: daysAgo(30) }),
    row('ok', { name: 'Amy', open_task_count: 1, oldest_open_due_at: daysAgo(-2), last_touch_at: daysAgo(9), crm_created_at: daysAgo(2) }),
    row('never', { name: 'Mo', open_task_count: 1, oldest_open_due_at: daysAgo(-2), last_touch_at: null, crm_created_at: daysAgo(10) }),
  ]
  it('most urgent puts the overdue follow-up first', () => {
    expect(sortRows(rows, 'urgent', rules, NOW)[0].id).toBe('late')
  })
  it('oldest touch: never touched first', () => {
    expect(sortRows(rows, 'touch', rules, NOW).map((r) => r.id)).toEqual(['never', 'ok', 'late'])
  })
  it('newest lead and name', () => {
    expect(sortRows(rows, 'newest', rules, NOW).map((r) => r.id)).toEqual(['ok', 'never', 'late'])
    expect(sortRows(rows, 'name', rules, NOW).map((r) => r.id)).toEqual(['ok', 'never', 'late'])
  })
  it('does not reorder the input', () => {
    const copy = [...rows]
    sortRows(rows, 'name', rules, NOW)
    expect(rows).toEqual(copy)
  })
})

describe('pipelineKpis', () => {
  it('Bayway: active, new this week, applications, stuck, with live footers', () => {
    const rows = [
      row('a', { stage: 'New Lead', crm_created_at: new Date(NOW - 20 * 60000).toISOString() }),
      row('b', { stage: 'Application Received', docs_outstanding_count: 2, docs_oldest_requested_at: daysAgo(9), crm_created_at: daysAgo(30) }),
      row('c', { stage: 'Attempted', stage_since: daysAgo(20), open_task_count: 1, oldest_open_due_at: daysAgo(2), crm_created_at: daysAgo(40) }),
    ]
    const k = pipelineKpis(rows, rules, 'bay', NOW)
    expect(k.map((x) => [x.id, x.value, x.foot])).toEqual([
      ['active', 3, '1 follow-up overdue'],
      ['new', 1, '1 past speed-to-lead'],
      ['received', 1, '1 with docs aging'],
      ['stuck', 1, '2 with no next step'],
    ])
    expect(k[3].tone).toBe('neg')
  })
  it('MPG counts qualified leads instead of applications', () => {
    const k = pipelineKpis([row('q', { stage: 'Qualified' }), row('n', { stage: 'Not Contacted' })], rules, 'mpg', NOW)
    expect(k[2]).toMatchObject({ id: 'qualified', value: 1 })
    expect(k[3]).toMatchObject({ value: 0, tone: 'book' })
  })
})

describe('leadSource', () => {
  it("is the CRM's lead source, trimmed", () => {
    expect(leadSource({ lead_source: '  Zillow ' })).toBe('Zillow')
  })
  it('is null when the CRM has none', () => {
    expect(leadSource({ lead_source: null })).toBe(null)
    expect(leadSource({ lead_source: '   ' })).toBe(null)
    expect(leadSource({ lead_source: '<unspecified>' })).toBe(null)
    expect(leadSource({ lead_source: '-None-' })).toBe(null)
    expect(leadSource({})).toBe(null)
  })
})
