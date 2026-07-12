import { describe, it, expect } from 'vitest'
import { mapEvent } from './ics-map.ts'

describe('mapEvent', () => {
  it('maps a single event, external_id = uid', () => {
    expect(
      mapEvent({
        uid: 'abc',
        summary: 'Closing — Ramirez',
        location: '123 Main',
        startIso: '2026-07-15T19:00:00.000Z',
        endIso: '2026-07-15T20:00:00.000Z',
        isAllDay: false,
      }),
    ).toEqual({
      external_id: 'abc',
      title: 'Closing — Ramirez',
      starts_at: '2026-07-15T19:00:00.000Z',
      ends_at: '2026-07-15T20:00:00.000Z',
      location: '123 Main',
      is_all_day: false,
    })
  })
  it('suffixes external_id with the occurrence key for recurring instances', () => {
    const r = mapEvent({
      uid: 'weekly',
      summary: 'Follow-up Block',
      startIso: '2026-07-16T20:00:00.000Z',
      endIso: '2026-07-16T21:00:00.000Z',
      isAllDay: false,
      occurrenceKey: '2026-07-16T20:00:00.000Z',
    })
    expect(r.external_id).toBe('weekly_2026-07-16T20:00:00.000Z')
  })
  it('nulls missing title/location/end and coerces is_all_day', () => {
    const r = mapEvent({ uid: 'x', startIso: '2026-07-20', isAllDay: true })
    expect(r.title).toBe(null)
    expect(r.location).toBe(null)
    expect(r.ends_at).toBe(null)
    expect(r.is_all_day).toBe(true)
  })
})
