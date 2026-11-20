import { describe, it, expect } from 'vitest'
import { focusWeekKey, shapeFocus } from './weeklyFocus'

describe('weekly focus', () => {
  it("keys the week by Monday in Chicago time", () => {
    expect(focusWeekKey(Date.parse('2026-11-20T16:00:00Z'))).toBe('2026-11-16') // Fri
    expect(focusWeekKey(Date.parse('2026-11-16T07:00:00Z'))).toBe('2026-11-16') // Mon 1 AM Chicago
    expect(focusWeekKey(Date.parse('2026-11-16T05:00:00Z'))).toBe('2026-11-09') // Sun 11 PM Chicago
    expect(focusWeekKey(Date.parse('2026-11-22T20:00:00Z'))).toBe('2026-11-16') // Sun
  })

  it('splits the focus from its tasks and counts done', () => {
    const m = shapeFocus([
      { id: 't2', focus_role: 'task', status: 'open', created_at: '2026-11-16T13:02:00Z' },
      { id: 'f', focus_role: 'focus', title: 'Get 3 applications' },
      { id: 't1', focus_role: 'task', status: 'done', created_at: '2026-11-16T13:01:00Z' },
    ])
    expect(m.focus.id).toBe('f')
    expect(m.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(m).toMatchObject({ done: 1, total: 2 })
    expect(shapeFocus([])).toEqual({ focus: null, tasks: [], done: 0, total: 0 })
  })
})
