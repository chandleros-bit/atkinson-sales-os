import { describe, it, expect } from 'vitest'
import { advanceStage, funnelSteps, rosterCounts, newClassRow } from './classes'
import { weeklyFocusLine, marketLines } from './briefing'

describe('class tracker', () => {
  it('moves a partner forward only', () => {
    expect(advanceStage('prospect', 'invited')).toBe('invited')
    expect(advanceStage('dream_20', 'registered')).toBe('invited')
    expect(advanceStage('invited', 'attended')).toBe('attended_class')
    expect(advanceStage('one_to_one', 'attended')).toBeNull()
    expect(advanceStage('attended_class', 'invited')).toBeNull()
    expect(advanceStage('prospect', 'no_show')).toBeNull()
  })

  it('counts a roster and builds funnel steps with step-to-step rates', () => {
    expect(rosterCounts([{ status: 'invited' }, { status: 'attended' }, { status: 'attended' }])).toEqual({ invited: 1, registered: 0, attended: 2, no_show: 0 })
    const steps = funnelSteps({ invited: 20, registered: 10, attended: 5, one_to_ones: 2, referrals: 1 })
    expect(steps.map((s) => [s.key, s.n, s.pct])).toEqual([
      ['invited', 20, null], ['registered', 10, 50], ['attended', 5, 50], ['one_to_ones', 2, 40], ['referrals', 1, 50],
    ])
    expect(funnelSteps(null).every((s) => s.n === 0)).toBe(true)
  })

  it('needs a date and a topic for a class', () => {
    expect(() => newClassRow({ topic: 'AI' })).toThrow('Pick a date')
    expect(() => newClassRow({ class_date: '2026-12-10', topic: ' ' })).toThrow('Topic is required')
    expect(newClassRow({ class_date: '2026-12-10', topic: ' AI follow-up ', host_brokerage: '' })).toEqual({ class_date: '2026-12-10', topic: 'AI follow-up', host_brokerage: null, location: null })
  })

  it('keeps the first 3 sentences of the market note and its first source', () => {
    const m = marketLines({ note: 'One. Two? Three. Four.', sources: [{ title: 'A' }, { title: 'B', url: 'https://b.com' }] })
    expect(m).toEqual({ lines: ['One.', 'Two?', 'Three.'], source: { title: 'B', url: 'https://b.com' } })
    expect(marketLines(null)).toBeNull()
  })

  it('summarizes the weekly focus for the briefing', () => {
    expect(weeklyFocusLine([])).toBeNull()
    expect(weeklyFocusLine([{ focus_role: 'focus', title: 'X' }, { focus_role: 'task', status: 'done' }, { focus_role: 'task', status: 'open' }])).toEqual({ title: 'X', done: 1, total: 2 })
  })
})
