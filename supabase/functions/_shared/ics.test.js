import { describe, it, expect } from 'vitest'
import { expandIcs } from './ics.ts'

// Two events at the same wall-clock time in DIFFERENT timezones.
//
// This shape is deliberate. If ical.js cannot resolve a TZID it falls back to
// "floating" and builds the Date from the HOST process's timezone — so both
// events below would collapse to the same instant. Their correct instants are
// 14 hours apart, so at least one assertion fails no matter what timezone the
// machine running the tests is in.
//
// A single-timezone fixture would not do this: on a Central-timezone machine a
// broken floating fallback produces exactly the right answer by coincidence,
// and the bug hides. That is the whole reason this went unnoticed in
// production — the edge runtime is UTC, developer machines here are Central.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN
BEGIN:VTIMEZONE
TZID:Central Standard Time
BEGIN:STANDARD
DTSTART:16011104T020000
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010311T020000
RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VTIMEZONE
TZID:Tokyo Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:houston-1
SUMMARY:Closing - Ramirez
DTSTART;TZID=Central Standard Time:20260721T090000
DTEND;TZID=Central Standard Time:20260721T100000
END:VEVENT
BEGIN:VEVENT
UID:tokyo-1
SUMMARY:Overseas call
DTSTART;TZID=Tokyo Standard Time:20260721T090000
DTEND;TZID=Tokyo Standard Time:20260721T100000
END:VEVENT
END:VCALENDAR`

const WINDOW_START = Date.UTC(2026, 6, 1)
const WINDOW_END = Date.UTC(2026, 7, 1)

const byUid = (rows, uid) => rows.find((r) => r.external_id === uid)

// An all-day event carries VALUE=DATE and no TZID — it is a calendar date, not
// an instant. It must be anchored at midnight UTC, the same date-marker
// convention Postgres uses and that calendar.js reads back.
const ALL_DAY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN
BEGIN:VEVENT
UID:allday-1
SUMMARY:Quarterly planning
DTSTART;VALUE=DATE:20260721
DTEND;VALUE=DATE:20260722
END:VEVENT
END:VCALENDAR`

describe('expandIcs all-day handling', () => {
  it('anchors an all-day event at midnight UTC, not the host timezone', () => {
    const rows = expandIcs(ALL_DAY_ICS, WINDOW_START, WINDOW_END)
    expect(rows).toHaveLength(1)
    expect(rows[0].is_all_day).toBe(true)
    // Host-timezone-dependent construction would give 05:00Z in Central or
    // the PREVIOUS day in Tokyo, both of which shift the rendered date.
    expect(rows[0].starts_at).toBe('2026-07-21T00:00:00.000Z')
    expect(rows[0].ends_at).toBe('2026-07-22T00:00:00.000Z')
  })
})

describe('expandIcs timezone resolution', () => {
  it('resolves a TZID against the feed’s own VTIMEZONE, not the host timezone', () => {
    const rows = expandIcs(ICS, WINDOW_START, WINDOW_END)

    // 09:00 in Central on 2026-07-21 is CDT (UTC-5) -> 14:00Z.
    expect(byUid(rows, 'houston-1').starts_at).toBe('2026-07-21T14:00:00.000Z')

    // 09:00 in Tokyo (UTC+9, no DST) -> 00:00Z the same day.
    expect(byUid(rows, 'tokyo-1').starts_at).toBe('2026-07-21T00:00:00.000Z')
  })

  it('keeps the two zones 14 hours apart rather than collapsing them', () => {
    const rows = expandIcs(ICS, WINDOW_START, WINDOW_END)
    const houston = new Date(byUid(rows, 'houston-1').starts_at).getTime()
    const tokyo = new Date(byUid(rows, 'tokyo-1').starts_at).getTime()

    // The failure mode this guards: a floating fallback builds both from the
    // same host offset, making the difference 0.
    expect(houston - tokyo).toBe(14 * 3600 * 1000)
  })

  it('still carries the event through with its title and end time', () => {
    const rows = expandIcs(ICS, WINDOW_START, WINDOW_END)
    const ev = byUid(rows, 'houston-1')
    expect(ev.title).toBe('Closing - Ramirez')
    expect(ev.ends_at).toBe('2026-07-21T15:00:00.000Z')
    expect(ev.is_all_day).toBe(false)
  })
})
