import { describe, it, expect } from 'vitest'
import { nextStep, stuckFor, cardHealth, healthRank, sortByHealth, columnSummary, speedToLead, formatElapsed } from './cardHealth'
import { DEFAULT_RULES } from './priorityQueue'

// Local times (no Z), the same convention as priorityQueue.test.js.
// 2026-10-18 is a Sunday.
const NOW = new Date('2026-10-18T09:00:00').getTime()
const daysAgo = (n, hh = '09:00:00') => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  const p = (x) => String(x).padStart(2, '0')
  return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hh}`).toISOString()
}
const rules = DEFAULT_RULES
const row = (o = {}) => ({
  id: o.id || 'x',
  stage: 'Attempted',
  stage_since: null,
  open_task_count: 0,
  oldest_open_due_at: null,
  last_touch_at: null,
  ...o,
})

describe('nextStep', () => {
  it('none when nothing is open', () => {
    expect(nextStep(row(), NOW)).toEqual({ state: 'none', text: 'No next step' })
  })
  it('overdue by whole local days', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: daysAgo(1) }), NOW)).toMatchObject({ state: 'overdue', text: 'Follow-up 1 day overdue' })
    expect(nextStep(row({ open_task_count: 2, oldest_open_due_at: daysAgo(3) }), NOW)).toMatchObject({ state: 'overdue', text: 'Follow-up 3 days overdue' })
  })
  it('due today, including later today', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: daysAgo(0, '17:00:00') }), NOW)).toEqual({ state: 'today', text: 'Due today' })
  })
  it('scheduled shows the weekday and date', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: daysAgo(-5) }), NOW)).toEqual({ state: 'scheduled', text: 'Next: Fri, Oct 23' })
  })
  it('an open task with no due date still counts as a next step', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: null }), NOW)).toEqual({ state: 'scheduled', text: 'Task open · no date' })
  })
  it('parked and lost leads show nothing', () => {
    expect(nextStep(row({ stage: 'Nurture / Credit Repair' }), NOW).state).toBe('parked')
    expect(nextStep(row({ stage: 'Lost' }), NOW).state).toBe('parked')
  })
})

describe('stuckFor', () => {
  it('flags at the per-stage limit', () => {
    expect(stuckFor(row({ stage_since: daysAgo(5) }), rules, NOW)).toEqual({ days: 5, text: '5d in Attempted' })
    expect(stuckFor(row({ stage_since: daysAgo(4) }), rules, NOW)).toBeNull()
  })
  it('falls back to stuck_days for MPG statuses', () => {
    expect(stuckFor(row({ stage: 'Open', stage_since: daysAgo(14) }), rules, NOW)).toEqual({ days: 14, text: '14d in Open' })
    expect(stuckFor(row({ stage: 'Open', stage_since: daysAgo(13) }), rules, NOW)).toBeNull()
  })
  it('never for unknown stage dates or parked leads', () => {
    expect(stuckFor(row({ stage_since: null }), rules, NOW)).toBeNull()
    expect(stuckFor(row({ stage: 'Nurture / Credit Repair', stage_since: daysAgo(90) }), rules, NOW)).toBeNull()
  })
})

describe('ordering and summary', () => {
  const overdue = row({ id: 'overdue', open_task_count: 1, oldest_open_due_at: daysAgo(2) })
  const stuck = row({ id: 'stuck', open_task_count: 1, oldest_open_due_at: daysAgo(-3), stage_since: daysAgo(6) })
  const none = row({ id: 'none' })
  const today = row({ id: 'today', open_task_count: 1, oldest_open_due_at: daysAgo(0, '15:00:00') })
  const scheduled = row({ id: 'scheduled', open_task_count: 1, oldest_open_due_at: daysAgo(-2) })

  it('ranks overdue, stuck, none, today, scheduled', () => {
    const ids = sortByHealth([scheduled, today, none, stuck, overdue], rules, NOW).map((r) => r.id)
    expect(ids).toEqual(['overdue', 'stuck', 'none', 'today', 'scheduled'])
  })
  it('keeps oldest-touch-first inside a rank', () => {
    const a = row({ id: 'a', last_touch_at: daysAgo(1) })
    const b = row({ id: 'b', last_touch_at: daysAgo(9) })
    expect(sortByHealth([a, b], rules, NOW).map((r) => r.id)).toEqual(['b', 'a'])
  })
  it('healthRank puts an overdue stuck card with the overdue ones', () => {
    const both = row({ open_task_count: 1, oldest_open_due_at: daysAgo(1), stage_since: daysAgo(30) })
    expect(healthRank(cardHealth(both, rules, NOW))).toBe(healthRank(cardHealth(overdue, rules, NOW)))
  })
  it('summarises a column', () => {
    expect(columnSummary([overdue, stuck, none], rules, NOW)).toBe('1 overdue · 1 stuck')
    expect(columnSummary([none, scheduled], rules, NOW)).toBe('')
  })
})

describe('speedToLead', () => {
  const fresh = (o = {}) => row({ stage: 'New Lead', crm_created_at: daysAgo(0, '08:56:00'), last_outbound_call_at: null, ...o })

  it('runs on a new, uncalled lead and turns late at speed_to_lead_minutes', () => {
    expect(speedToLead(fresh(), rules, NOW)).toEqual({ minutes: 4, late: false, text: '4m · not called' })
    expect(speedToLead(fresh({ crm_created_at: daysAgo(0, '08:55:00') }), rules, NOW)).toEqual({ minutes: 5, late: true, text: '5m · not called' })
  })
  it('also runs on MPG Not Contacted / Open', () => {
    expect(speedToLead(fresh({ stage: 'Not Contacted' }), rules, NOW)).not.toBeNull()
    expect(speedToLead(fresh({ stage: 'Open' }), rules, NOW)).not.toBeNull()
  })
  it('stops once called, outside the first column, or after new_lead_days', () => {
    expect(speedToLead(fresh({ last_outbound_call_at: daysAgo(0, '08:58:00') }), rules, NOW)).toBeNull()
    expect(speedToLead(fresh({ stage: 'Attempted' }), rules, NOW)).toBeNull()
    expect(speedToLead(fresh({ crm_created_at: daysAgo(8) }), rules, NOW)).toBeNull()
    expect(speedToLead(fresh({ crm_created_at: null }), rules, NOW)).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('minutes, hours and minutes, then days', () => {
    expect(formatElapsed(0)).toBe('0m')
    expect(formatElapsed(59)).toBe('59m')
    expect(formatElapsed(60)).toBe('1h')
    expect(formatElapsed(72)).toBe('1h 12m')
    expect(formatElapsed(47 * 60 + 59)).toBe('47h 59m')
    expect(formatElapsed(48 * 60)).toBe('2d')
  })
})

describe('speed in health and ordering', () => {
  it('cardHealth carries speed, and new uncalled leads sort first, late ones before fresh ones', () => {
    const late = row({ id: 'late', stage: 'New Lead', crm_created_at: daysAgo(0, '08:00:00') })
    const freshLead = row({ id: 'fresh', stage: 'New Lead', crm_created_at: daysAgo(0, '08:58:00') })
    const overdue = row({ id: 'overdue', stage: 'New Lead', crm_created_at: daysAgo(30), open_task_count: 1, oldest_open_due_at: daysAgo(2) })
    expect(cardHealth(late, rules, NOW).speed).toMatchObject({ late: true })
    expect(sortByHealth([overdue, freshLead, late], rules, NOW).map((r) => r.id)).toEqual(['late', 'fresh', 'overdue'])
  })
})
