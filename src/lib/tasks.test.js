import { describe, it, expect } from 'vitest'
import {
  BUCKETS,
  bucketByDue,
  dueDayKey,
  dueLabel,
  dueTimeOfDay,
  normalizePriority,
  filterByPriority,
} from './tasks'

const now = new Date('2026-07-19T12:00:00').getTime()

describe('dueLabel', () => {
  it('labels today, tomorrow, and yesterday', () => {
    expect(dueLabel('2026-07-19T09:00:00', now)).toBe('Today')
    expect(dueLabel('2026-07-20T09:00:00', now)).toBe('Tomorrow')
    expect(dueLabel('2026-07-18T09:00:00', now)).toBe('Yesterday')
  })
  it('labels other days by weekday and date', () => {
    expect(dueLabel('2026-07-22T09:00:00', now)).toBe('Wed · Jul 22')
  })
  it('handles a null due date', () => {
    expect(dueLabel(null, now)).toBe('No due date')
  })
  it('handles an unparseable due date without rendering NaN', () => {
    expect(dueLabel('not-a-date', now)).toBe('No due date')
  })
})

describe('dueTimeOfDay', () => {
  it('formats a time of day', () => {
    expect(dueTimeOfDay('2026-07-19T09:05:00')).toBe('9:05a')
    expect(dueTimeOfDay('2026-07-19T14:30:00')).toBe('2:30p')
  })
  it('returns an em dash for a null due date', () => {
    expect(dueTimeOfDay(null)).toBe('—')
  })
  it('returns an em dash for a date-only due date stored as midnight UTC', () => {
    expect(dueTimeOfDay('2026-07-19T00:00:00Z')).toBe('—')
    expect(dueTimeOfDay('2026-07-19T00:00:00+00:00')).toBe('—')
  })
})

// The bug this guards: both CRMs send date-only due dates, Postgres stores
// them as midnight UTC, and reading that locally lands on the previous evening
// anywhere west of Greenwich — shifting every task a day early.
describe('date-only due dates', () => {
  it('keys a midnight-UTC due date to its own calendar date', () => {
    expect(dueDayKey('2026-07-21T00:00:00Z')).toBe('2026-07-21')
  })
  it('keys a real instant in local time', () => {
    expect(dueDayKey('2026-07-21T14:30:00')).toBe('2026-07-21')
  })
  it('buckets a date-only task due today as Today, not Overdue', () => {
    const rows = [{ id: 'x', due_at: '2026-07-19T00:00:00Z' }]
    const by = bucketByDue(rows, now)
    expect(by.find((b) => b.key === 'today').rows.map((r) => r.id)).toEqual(['x'])
    expect(by.find((b) => b.key === 'overdue').rows).toHaveLength(0)
  })
  it('labels a date-only task due tomorrow as Tomorrow', () => {
    expect(dueLabel('2026-07-20T00:00:00Z', now)).toBe('Tomorrow')
  })
})

describe('normalizePriority', () => {
  it('folds Zoho and FUB values into three keys', () => {
    expect(normalizePriority('Highest')).toBe('high')
    expect(normalizePriority('High')).toBe('high')
    expect(normalizePriority('Normal')).toBe('normal')
    expect(normalizePriority('Medium')).toBe('normal')
    expect(normalizePriority('Low')).toBe('low')
    expect(normalizePriority('Lowest')).toBe('low')
  })
  it('folds urgent to high', () => {
    expect(normalizePriority('urgent')).toBe('high')
  })
  it('tolerates surrounding whitespace', () => {
    expect(normalizePriority('  High  ')).toBe('high')
    expect(normalizePriority('Normal\n')).toBe('normal')
  })
  it('returns null for missing or unknown values', () => {
    expect(normalizePriority(null)).toBe(null)
    expect(normalizePriority('Whatever')).toBe(null)
  })
})

describe('filterByPriority', () => {
  const rows = [{ priority: 'High' }, { priority: 'Normal' }, { priority: null }]
  it('passes everything for "all"', () => {
    expect(filterByPriority(rows, 'all')).toHaveLength(3)
  })
  it('filters on the normalized key', () => {
    expect(filterByPriority(rows, 'high')).toHaveLength(1)
    expect(filterByPriority(rows, 'normal')).toHaveLength(1)
    expect(filterByPriority(rows, 'low')).toHaveLength(0)
  })
})

describe('bucketByDue', () => {
  const rows = [
    { id: 'a', due_at: '2026-07-17T09:00:00' }, // 2 days ago
    { id: 'b', due_at: '2026-07-18T09:00:00' }, // yesterday
    { id: 'c', due_at: '2026-07-19T16:00:00' }, // today, later
    { id: 'd', due_at: '2026-07-19T08:00:00' }, // today, earlier (already past)
    { id: 'e', due_at: '2026-07-20T09:00:00' }, // tomorrow
    { id: 'f', due_at: '2026-07-25T09:00:00' }, // upcoming
    { id: 'g', due_at: null }, // no due date
  ]

  it('returns the five buckets in a fixed order', () => {
    expect(bucketByDue(rows, now).map((b) => b.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'upcoming',
      'none',
    ])
  })

  it('places rows in the right buckets', () => {
    const by = Object.fromEntries(bucketByDue(rows, now).map((b) => [b.key, b.rows.map((r) => r.id)]))
    expect(by.overdue).toEqual(['a', 'b'])
    expect(by.today).toEqual(['d', 'c'])
    expect(by.tomorrow).toEqual(['e'])
    expect(by.upcoming).toEqual(['f'])
    expect(by.none).toEqual(['g'])
  })

  it('keeps a task due earlier today in Today, not Overdue', () => {
    const by = bucketByDue([{ id: 'd', due_at: '2026-07-19T08:00:00' }], now)
    expect(by.find((b) => b.key === 'today').rows).toHaveLength(1)
    expect(by.find((b) => b.key === 'overdue').rows).toHaveLength(0)
  })

  it('sorts every dated bucket ascending (most-overdue first)', () => {
    const overdue = bucketByDue(rows, now).find((b) => b.key === 'overdue')
    expect(overdue.rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('labels each bucket', () => {
    expect(bucketByDue(rows, now).map((b) => b.label)).toEqual([
      'Overdue',
      'Today',
      'Tomorrow',
      'Upcoming',
      'No due date',
    ])
  })

  it('does not mutate the input array', () => {
    const input = [...rows]
    bucketByDue(input, now)
    expect(input.map((r) => r.id)).toEqual(rows.map((r) => r.id))
  })

  it('returns empty buckets rather than dropping them', () => {
    expect(bucketByDue([], now)).toHaveLength(5)
    expect(bucketByDue([], now).every((b) => b.rows.length === 0)).toBe(true)
  })

  it('exposes BUCKETS in the same order it emits', () => {
    expect(BUCKETS.map((b) => b.key)).toEqual(bucketByDue([], now).map((b) => b.key))
  })
})
