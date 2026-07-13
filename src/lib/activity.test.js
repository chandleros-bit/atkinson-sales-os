import { describe, it, expect } from 'vitest'
import { filterByType, groupByDay, activityDayLabel, timeOfDay } from './activity'

describe('filterByType', () => {
  const rows = [{ type: 'call' }, { type: 'text' }, { type: 'call' }]
  it('returns everything for "all"', () => {
    expect(filterByType(rows, 'all')).toHaveLength(3)
  })
  it('filters to a single type', () => {
    expect(filterByType(rows, 'call')).toHaveLength(2)
  })
})

describe('activityDayLabel', () => {
  const now = new Date('2026-07-13T12:00:00').getTime()
  it('labels today and yesterday', () => {
    expect(activityDayLabel('2026-07-13T09:00:00', now)).toBe('Today')
    expect(activityDayLabel('2026-07-12T09:00:00', now)).toBe('Yesterday')
  })
  it('labels older days by weekday and date', () => {
    expect(activityDayLabel('2026-07-09T09:00:00', now)).toBe('Thu · Jul 9')
  })
})

describe('groupByDay', () => {
  const now = new Date('2026-07-13T12:00:00').getTime()
  it('orders days most-recent first and rows within a day descending', () => {
    const rows = [
      { id: 1, occurred_at: '2026-07-12T10:00:00' },
      { id: 2, occurred_at: '2026-07-13T08:00:00' },
      { id: 3, occurred_at: '2026-07-13T11:00:00' },
    ]
    const groups = groupByDay(rows, now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0].rows.map((r) => r.id)).toEqual([3, 2])
  })
  it('skips rows with no occurred_at', () => {
    expect(groupByDay([{ id: 1, occurred_at: null }], now)).toEqual([])
  })
  it('does not mutate the input array', () => {
    const rows = [
      { id: 1, occurred_at: '2026-07-12T10:00:00' },
      { id: 2, occurred_at: '2026-07-13T08:00:00' },
    ]
    const copy = [...rows]
    groupByDay(rows, now)
    expect(rows).toEqual(copy)
  })
})

describe('timeOfDay', () => {
  it('formats 12-hour time with an a/p suffix', () => {
    expect(timeOfDay('2026-07-13T09:05:00')).toBe('9:05a')
    expect(timeOfDay('2026-07-13T16:30:00')).toBe('4:30p')
  })
  it('handles midnight and noon boundaries', () => {
    expect(timeOfDay('2026-07-13T00:00:00')).toBe('12:00a')
    expect(timeOfDay('2026-07-13T12:00:00')).toBe('12:00p')
  })
})
