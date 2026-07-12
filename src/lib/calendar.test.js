import { describe, it, expect } from 'vitest'
import { sourceToBiz, dayKey, dayLabel, timeLabel, groupByDay } from './calendar'

// Build local-time ISO strings so tests are deterministic regardless of env TZ.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()

describe('sourceToBiz', () => {
  it('maps outlook sources to businesses', () => {
    expect(sourceToBiz('outlook-mpg')).toBe('mpg')
    expect(sourceToBiz('outlook-bayway')).toBe('bay')
    expect(sourceToBiz('something')).toBe(null)
  })
})

describe('dayKey', () => {
  it('is the local calendar date', () => {
    expect(dayKey(local(2026, 7, 15, 14, 0))).toBe('2026-07-15')
  })
})

describe('dayLabel', () => {
  const now = local(2026, 7, 11, 9, 0)
  it('says Today / Tomorrow / weekday·date', () => {
    expect(dayLabel(local(2026, 7, 11, 15, 0), now)).toBe('Today')
    expect(dayLabel(local(2026, 7, 12, 15, 0), now)).toBe('Tomorrow')
    expect(dayLabel(local(2026, 7, 15, 15, 0), now)).toBe('Wed · Jul 15')
  })
})

describe('timeLabel', () => {
  it('says All day for all-day events', () => {
    expect(timeLabel({ is_all_day: true, starts_at: local(2026, 7, 15) })).toBe('All day')
  })
  it('formats 12-hour time for timed events', () => {
    expect(timeLabel({ is_all_day: false, starts_at: local(2026, 7, 15, 14, 30) })).toBe('2:30 PM')
    expect(timeLabel({ is_all_day: false, starts_at: local(2026, 7, 15, 9, 5) })).toBe('9:05 AM')
  })
})

describe('groupByDay', () => {
  const now = local(2026, 7, 11, 9, 0)
  const evs = [
    { id: 'b', starts_at: local(2026, 7, 12, 10, 0) },
    { id: 'a', starts_at: local(2026, 7, 11, 16, 0) },
    { id: 'c', starts_at: local(2026, 7, 11, 8, 0) },
  ]
  it('groups by day in date order, events time-ordered within a day', () => {
    const g = groupByDay(evs, now)
    expect(g.map((x) => x.label)).toEqual(['Today', 'Tomorrow'])
    expect(g[0].events.map((e) => e.id)).toEqual(['c', 'a'])
    expect(g[1].events.map((e) => e.id)).toEqual(['b'])
  })
  it('does not mutate the input', () => {
    const copy = [...evs]
    groupByDay(evs, now)
    expect(evs).toEqual(copy)
  })
})
