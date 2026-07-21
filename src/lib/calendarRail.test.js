import { describe, it, expect } from 'vitest'
import { todayEvents, isSyncStale, SYNC_INTERVAL_MS } from './calendarRail'

// Local-time ISO so tests are deterministic regardless of env TZ.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()

// An all-day event is stored anchored at midnight UTC, not local midnight.
// This fixture previously used local midnight — a value production never
// produces — which is why the day-shift bug passed unnoticed here.
const allDayMarker = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).toISOString()

describe('todayEvents', () => {
  const now = local(2026, 7, 19, 9, 0)
  const rows = [
    { id: 'yesterday', is_all_day: false, starts_at: local(2026, 7, 18, 10, 0) },
    { id: 'timed-pm', is_all_day: false, starts_at: local(2026, 7, 19, 14, 0) },
    { id: 'timed-am', is_all_day: false, starts_at: local(2026, 7, 19, 8, 30) },
    { id: 'allday', is_all_day: true, starts_at: allDayMarker(2026, 7, 19) },
    { id: 'tomorrow', is_all_day: false, starts_at: local(2026, 7, 20, 9, 0) },
  ]

  it('keeps only today, all-day first, then by start time', () => {
    const out = todayEvents(rows, now)
    expect(out.map((e) => e.id)).toEqual(['allday', 'timed-am', 'timed-pm'])
  })

  it('does not mutate the input', () => {
    const copy = [...rows]
    todayEvents(rows, now)
    expect(rows).toEqual(copy)
  })

  it('drops rows without a start time', () => {
    expect(todayEvents([{ id: 'x', starts_at: null }], now)).toEqual([])
  })
})

describe('isSyncStale', () => {
  const now = local(2026, 7, 19, 12, 0)
  const nowMs = new Date(now).getTime()

  it('is stale when there is no successful sync', () => {
    expect(isSyncStale(null, nowMs)).toBe(true)
  })

  it('is fresh within one interval past due', () => {
    expect(isSyncStale(nowMs - 20 * 60 * 1000, nowMs)).toBe(false)
  })

  it('is stale once a full cycle is missed', () => {
    expect(isSyncStale(nowMs - 40 * 60 * 1000, nowMs)).toBe(true)
  })

  it('stays fresh between due and stale (25 min)', () => {
    expect(isSyncStale(nowMs - 25 * 60 * 1000, nowMs)).toBe(false)
  })

  it('exposes the 15-minute interval', () => {
    expect(SYNC_INTERVAL_MS).toBe(15 * 60 * 1000)
  })
})
