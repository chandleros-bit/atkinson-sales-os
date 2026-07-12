// ICS fetch + parse + recurrence expansion using ical.js.
// Not vitest-tested (esm.sh import); verified on a real feed. Read-only.
import ICAL from 'https://esm.sh/ical.js@1.5.0'
import { mapEvent } from './ics-map.ts'

const OCCURRENCE_CAP = 1000 // guard runaway RRULEs

// Fetch an ICS URL and return calendar_events rows whose start is within
// [windowStartMs, windowEndMs). Expands recurring events.
export async function fetchAndExpand(url, windowStartMs, windowEndMs) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ICS fetch -> ${res.status}`)
  const text = await res.text()
  const comp = new ICAL.Component(ICAL.parse(text))
  const rows = []

  for (const ve of comp.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(ve)
    const isAllDay = event.startDate.isDate

    if (!event.isRecurring()) {
      const startMs = event.startDate.toJSDate().getTime()
      if (startMs >= windowStartMs && startMs < windowEndMs) {
        rows.push(
          mapEvent({
            uid: event.uid,
            summary: event.summary,
            location: event.location,
            startIso: event.startDate.toJSDate().toISOString(),
            endIso: event.endDate ? event.endDate.toJSDate().toISOString() : null,
            isAllDay,
          }),
        )
      }
      continue
    }

    const iter = event.iterator()
    let next
    let count = 0
    while ((next = iter.next()) && count < OCCURRENCE_CAP) {
      count++
      const startMs = next.toJSDate().getTime()
      if (startMs >= windowEndMs) break
      if (startMs < windowStartMs) continue
      const det = event.getOccurrenceDetails(next)
      rows.push(
        mapEvent({
          uid: event.uid,
          summary: event.summary,
          location: event.location,
          startIso: det.startDate.toJSDate().toISOString(),
          endIso: det.endDate ? det.endDate.toJSDate().toISOString() : null,
          isAllDay,
          occurrenceKey: det.startDate.toJSDate().toISOString(),
        }),
      )
    }
  }
  return rows
}
