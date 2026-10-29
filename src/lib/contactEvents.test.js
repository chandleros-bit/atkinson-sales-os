import { describe, it, expect } from 'vitest'
import {
  buildEventRow,
  toCalendarEvent,
  crmNoteBody,
  eventWhenLabel,
  dueReminders,
  defaultStartTime,
  startsIn,
  REMIND_GRACE_MIN,
} from './contactEvents'
import { sourceToBiz } from './calendar'

// Local wall-clock instants, so tests read the same in any TZ.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
const NOW = local(2026, 10, 29, 9, 0) // Thu Oct 29 2026, 9:00 AM

describe('buildEventRow', () => {
  const form = {
    businessId: 'mpg',
    contactId: 'c1',
    kind: 'call',
    dayKey: '2026-10-30',
    time: '14:30',
    durationMin: 30,
    remindMin: 10,
    note: '  bring rates ',
  }

  it('turns the form into an insert row, reading the time as local', () => {
    expect(buildEventRow(form, NOW)).toEqual({
      business_id: 'mpg',
      contact_id: 'c1',
      kind: 'call',
      starts_at: local(2026, 10, 30, 14, 30).toISOString(),
      duration_min: 30,
      remind_min: 10,
      note: 'bring rates',
    })
  })

  it('keeps "no reminder" and an empty note as null', () => {
    const row = buildEventRow({ ...form, remindMin: null, note: '  ' }, NOW)
    expect(row.remind_min).toBe(null)
    expect(row.note).toBe(null)
  })

  it('rejects a missing contact, a bad kind, a bad time or a past start', () => {
    expect(() => buildEventRow({ ...form, contactId: null }, NOW)).toThrow(/contact/i)
    expect(() => buildEventRow({ ...form, businessId: 'x' }, NOW)).toThrow(/book/i)
    expect(() => buildEventRow({ ...form, kind: 'lunch' }, NOW)).toThrow(/call or meeting/i)
    expect(() => buildEventRow({ ...form, time: '25:00' }, NOW)).toThrow(/time/i)
    expect(() => buildEventRow({ ...form, dayKey: '' }, NOW)).toThrow(/date/i)
    expect(() => buildEventRow({ ...form, dayKey: '2026-10-29', time: '08:00' }, NOW)).toThrow(/past/i)
  })
})

describe('toCalendarEvent', () => {
  const row = {
    id: 'e1',
    business_id: 'mpg',
    contact_id: 'c1',
    kind: 'call',
    starts_at: local(2026, 10, 30, 14, 30).toISOString(),
    duration_min: 45,
    note: 'bring rates',
    status: 'scheduled',
    contacts: { name: 'Jane Doe' },
  }

  it('maps a row onto the calendar event shape', () => {
    expect(toCalendarEvent(row)).toEqual({
      id: 'os:e1',
      source_account: 'os-mpg',
      title: 'Call · Jane Doe',
      starts_at: row.starts_at,
      ends_at: local(2026, 10, 30, 15, 15).toISOString(),
      is_all_day: false,
      location: 'bring rates',
      os: true,
      kind: 'call',
      status: 'scheduled',
      contact_id: 'c1',
      contact_name: 'Jane Doe',
    })
  })

  it('names a meeting and falls back when the contact is gone', () => {
    const ev = toCalendarEvent({ ...row, business_id: 'bay', kind: 'meeting', contacts: null, note: null })
    expect(ev.title).toBe('Meeting · Contact')
    expect(ev.source_account).toBe('os-bay')
    expect(ev.location).toBe(null)
  })

  it('reads back as its book', () => {
    expect(sourceToBiz(toCalendarEvent(row).source_account)).toBe('mpg')
    expect(sourceToBiz('os-bay')).toBe('bay')
  })
})

describe('labels', () => {
  const iso = local(2026, 10, 30, 14, 30).toISOString()

  it('eventWhenLabel is weekday, month/day and time', () => {
    expect(eventWhenLabel(iso)).toBe('Fri 10/30 2:30 PM')
  })

  it('crmNoteBody says what was scheduled', () => {
    expect(crmNoteBody({ kind: 'call', starts_at: iso, duration_min: 30, note: 'bring rates' })).toBe(
      'Scheduled call Fri 10/30 2:30 PM · 30 min — bring rates',
    )
    expect(crmNoteBody({ kind: 'meeting', starts_at: iso, duration_min: 60, note: null })).toBe(
      'Scheduled meeting Fri 10/30 2:30 PM · 60 min',
    )
  })

  it('startsIn counts down and says now once it starts', () => {
    expect(startsIn(local(2026, 10, 29, 9, 10).toISOString(), NOW)).toBe('in 10 min')
    expect(startsIn(local(2026, 10, 29, 10, 30).toISOString(), NOW)).toBe('in 1h 30m')
    expect(startsIn(local(2026, 10, 29, 8, 58).toISOString(), NOW)).toBe('now')
  })

  it('defaultStartTime is the next half hour', () => {
    expect(defaultStartTime(local(2026, 10, 29, 9, 0))).toEqual({ dayKey: '2026-10-29', time: '09:30' })
    expect(defaultStartTime(local(2026, 10, 29, 9, 31))).toEqual({ dayKey: '2026-10-29', time: '10:00' })
    expect(defaultStartTime(local(2026, 10, 29, 23, 45))).toEqual({ dayKey: '2026-10-30', time: '00:00' })
  })
})

describe('dueReminders', () => {
  const start = local(2026, 10, 29, 9, 30)
  const ev = { id: 'e1', status: 'scheduled', starts_at: start.toISOString(), remind_min: 10, reminded_at: null }
  const at = (h, mi) => local(2026, 10, 29, h, mi).getTime()

  it('opens remind_min before the start and closes the grace minutes after', () => {
    expect(dueReminders([ev], at(9, 19))).toEqual([])
    expect(dueReminders([ev], at(9, 20))).toEqual([ev])
    expect(dueReminders([ev], at(9, 30 + REMIND_GRACE_MIN - 1))).toEqual([ev])
    expect(dueReminders([ev], at(9, 30 + REMIND_GRACE_MIN))).toEqual([])
  })

  it('skips no-reminder, already-reminded, already-fired and non-scheduled events', () => {
    const now = at(9, 25)
    expect(dueReminders([{ ...ev, remind_min: null }], now)).toEqual([])
    expect(dueReminders([{ ...ev, reminded_at: '2026-10-29T13:20:00Z' }], now)).toEqual([])
    expect(dueReminders([ev], now, new Set(['e1']))).toEqual([])
    expect(dueReminders([{ ...ev, status: 'canceled' }], now)).toEqual([])
  })

  it('a zero-minute reminder fires at the start', () => {
    expect(dueReminders([{ ...ev, remind_min: 0 }], at(9, 29))).toEqual([])
    expect(dueReminders([{ ...ev, remind_min: 0 }], at(9, 30))).toHaveLength(1)
  })
})
