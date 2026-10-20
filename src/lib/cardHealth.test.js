import { describe, it, expect } from 'vitest'
import { nextStep, stuckFor, cardHealth, healthRank, sortByHealth, columnSummary } from './cardHealth'
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
