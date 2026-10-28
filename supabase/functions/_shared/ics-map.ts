// Pure mapping: normalized ICS event fields -> a calendar_events row.
// No ical.js import here so it stays unit-testable in vitest.

// Outlook keeps a canceled meeting on an attendee's calendar, retitled
// "Canceled: ...", until someone removes it by hand, and the published feed
// keeps serving it. Google invites read "Canceled event: ...". Either way, or an
// explicit STATUS:CANCELLED, it is not a meeting anymore.
const CANCELED_TITLE = /^cancell?ed( event)?:/i

export function isCanceled({ status, summary }) {
  return String(status || '').toUpperCase() === 'CANCELLED' || CANCELED_TITLE.test(String(summary || '').trim())
}

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
