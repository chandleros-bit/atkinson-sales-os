import { describe, it, expect } from 'vitest'
import { wrapDue, tomorrowTheme, buildWrap, movedToday } from './dayWrap'

// Monday, Nov 23 2026.
const at = (hh, mm = 0) => new Date(2026, 10, 23, hh, mm).getTime()

describe('wrapDue', () => {
  const lists = (n) => [{ key: 'calls', count: n }, { key: 'files', count: 0 }]
  it('offers the wrap when the lists are done or from 5:30 PM', () => {
    expect(wrapDue(lists(3), at(16, 0))).toBe(false)
    expect(wrapDue(lists(0), at(11, 0))).toBe(true)
    expect(wrapDue(lists(3), at(17, 29))).toBe(false)
    expect(wrapDue(lists(3), at(17, 30))).toBe(true)
  })
})

describe('tomorrowTheme', () => {
  it("names the next weekday's theme, Friday to Monday", () => {
    expect(tomorrowTheme(at(10))).toMatchObject({ key: 'loan_status', weekday: 'Tuesday' })
    expect(tomorrowTheme(new Date(2026, 10, 27, 10).getTime())).toMatchObject({ key: 'new_realtor', weekday: 'Monday' })
  })
})

describe('buildWrap', () => {
  const saved = {
    lists: { calls: ['contact:a', 'contact:b', 'contact:c'], files: ['estimate:e', 'application:f'], partners: [] },
    pulled_in: ['contact:d'],
    wrap: { morning: { gap: 2640 } },
  }
  const lists = [
    { key: 'calls', count: 2, items: [{ id: 'c', row: { name: 'Nina Ford' } }, { id: 'd', row: { name: 'Luis Park' } }] },
    { key: 'files', count: 1, items: [{ key: 'application:f', name: 'Kayla Moss' }] },
    { key: 'partners', count: 0, items: [] },
  ]

  it('counts done against the day, lists what rolls, and previews tomorrow', () => {
    const w = buildWrap({ saved, lists, filesDone: 1, callsLogged: 6, hardOpen: 1, gapNow: 1980, moved: [{ id: 'x', name: 'Alicia', stage: 'Pre-Approved', value: '$2,400' }], now: at(17, 42) })
    expect(w.counts.map((c) => [c.key, c.done, c.total, c.note])).toEqual([
      ['calls', 2, 4, '6 logged'],
      ['files', 1, 2, '1 rolled'],
      ['partners', 0, 0, 'none today'],
      ['hard', null, 1, 'still open'],
    ])
    expect(w.gap).toEqual({ now: 1980, morning: 2640 })
    expect(w.rolled.map((r) => [r.list, r.name])).toEqual([
      ['Calls', 'Nina Ford'],
      ['Calls', 'Luis Park'],
      ['Files', 'Kayla Moss'],
    ])
    expect(w.tomorrow).toEqual({ theme: 'Loan status', weekday: 'Tuesday', rolled: 3, first: ['Nina Ford', 'Luis Park'] })
    expect(w.moved).toHaveLength(1)
  })

  it('works without a saved order (the lists were live all day)', () => {
    const w = buildWrap({ saved: null, lists, now: at(18) })
    expect(w.counts[0]).toMatchObject({ done: 0, total: 2 })
    expect(w.gap.morning).toBe(null)
  })
})

describe('movedToday', () => {
  it('keeps people whose stage changed today, once each, with their value', () => {
    const rows = [
      { id: 'a', name: 'Alicia', stage: 'Pre-Approved', stage_since: new Date(2026, 10, 23, 9).toISOString() },
      { id: 'a', name: 'Alicia', stage: 'Pre-Approved', stage_since: new Date(2026, 10, 23, 9).toISOString() },
      { id: 'b', name: 'Old', stage: 'Disclosed', stage_since: new Date(2026, 10, 20, 9).toISOString() },
      { id: 'c', name: 'No date', stage: 'Attempted' },
    ]
    const out = movedToday(rows, { now: at(17), valueOf: (id) => (id === 'a' ? { text: '$2,400' } : null) })
    expect(out).toEqual([{ id: 'a', name: 'Alicia', stage: 'Pre-Approved', value: '$2,400' }])
  })
})
