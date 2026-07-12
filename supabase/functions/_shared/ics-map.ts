// Pure mapping: normalized ICS event fields -> a calendar_events row.
// No ical.js import here so it stays unit-testable in vitest.

export function mapEvent({ uid, summary, location, startIso, endIso, isAllDay, occurrenceKey = null }) {
  return {
    external_id: occurrenceKey ? `${uid}_${occurrenceKey}` : String(uid),
    title: summary || null,
    starts_at: startIso,
    ends_at: endIso || null,
    location: location || null,
    is_all_day: !!isAllDay,
  }
}
