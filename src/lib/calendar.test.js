import { describe, it, expect } from 'vitest'
import { sourceToBiz, dayKey, eventDayKey, dayLabel, timeLabel, groupByDay } from './calendar'

// Build local-time ISO strings so tests are deterministic regardless of env TZ.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()

// An all-day event is a DATE, not an instant. It is stored anchored at midnight
// UTC — NOT local midnight. That distinction is the entire bug: read with local
// getters, the marker lands on the previous evening anywhere west of Greenwich
// and the event renders a day early.
const allDayMarker = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).toISOString()

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

describe('eventDayKey', () => {
  // TZ-independent: an all-day marker must always resolve to its own date,
  // whatever timezone the machine running this is in.
  it('reads an all-day marker in UTC, so it never shifts a day', () => {
    expect(eventDayKey({ is_all_day: true, starts_at: allDayMarker(2026, 7, 21) })).toBe(
      '2026-07-21',
    )
  })

  it('reads a timed event in local time, where the wall clock is what matters', () => {
    expect(eventDayKey({ is_all_day: false, starts_at: local(2026, 7, 21, 14, 0) })).toBe(
      '2026-07-21',
    )
  })
})

describe('dayLabel', () => {
  // Takes a calendar-day key, not an ISO instant — a key cannot be misread as
  // local-vs-UTC, which is what caused all-day events to shift.
  const now = local(2026, 7, 11, 9, 0)
  it('says Today / Tomorrow / weekday·date', () => {
    expect(dayLabel('2026-07-11', now)).toBe('Today')
    expect(dayLabel('2026-07-12', now)).toBe('Tomorrow')
    expect(dayLabel('2026-07-15', now)).toBe('Wed · Jul 15')
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

  it('puts an all-day event on its own date, not the day before', () => {
    const today = local(2026, 7, 21, 9, 0)
    const g = groupByDay(
      [{ id: 'allday', is_all_day: true, starts_at: allDayMarker(2026, 7, 21) }],
      today,
    )
    expect(g[0].dayKey).toBe('2026-07-21')
    expect(g[0].label).toBe('Today')
  })

  it('groups an all-day event with timed events on the same calendar date', () => {
    const today = local(2026, 7, 21, 9, 0)
    const g = groupByDay(
      [
        { id: 'timed', is_all_day: false, starts_at: local(2026, 7, 21, 14, 0) },
        { id: 'allday', is_all_day: true, starts_at: allDayMarker(2026, 7, 21) },
      ],
      today,
    )
    expect(g).toHaveLength(1)
    expect(g[0].events.map((e) => e.id).sort()).toEqual(['allday', 'timed'])
  })
})
