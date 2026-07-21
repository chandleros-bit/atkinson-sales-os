// Pure agenda helpers for the Calendar screen. No React, no I/O.
// Dates use the browser's local timezone (events are stored as UTC ISO).

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function sourceToBiz(source) {
  if (source === 'outlook-mpg') return 'mpg'
  if (source === 'outlook-bayway') return 'bay'
  return null
}

export function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The calendar day an event belongs to.
//
// A timed event is an instant: the local wall clock is what matters. An all-day
// event is a DATE, stored anchored at midnight UTC — reading that with local
// getters lands on the previous evening anywhere west of Greenwich, so the
// event renders a day early and drops out of "today" entirely.
//
// Same hazard tasks.js documents for date-only CRM due dates, but here we have
// an explicit is_all_day flag, so there is no need to infer it from the clock.
export function eventDayKey(ev) {
  if (!ev?.is_all_day) return dayKey(ev?.starts_at)
  const d = new Date(ev.starts_at)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}

// Takes a calendar-day key ('YYYY-MM-DD'), not an ISO instant. A key cannot be
// misread as local-vs-UTC, which is exactly how all-day events used to shift.
export function dayLabel(key, now = Date.now()) {
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const tomorrowKey = dayKey(tmr.toISOString())
  if (key === todayKey) return 'Today'
  if (key === tomorrowKey) return 'Tomorrow'
  // Built from the key's own parts, so formatting never re-introduces an offset.
  const [y, m, d] = String(key).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DAYS[dt.getDay()]} · ${MONTHS[dt.getMonth()]} ${dt.getDate()}`
}

export function timeLabel(ev) {
  if (ev.is_all_day) return 'All day'
  const d = new Date(ev.starts_at)
  const m = d.getMinutes()
  let h = d.getHours()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// events -> ordered [{ dayKey, label, events }]; events sorted by start.
export function groupByDay(events, now = Date.now()) {
  const sorted = [...events].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  const byKey = new Map()
  const groups = []
  for (const ev of sorted) {
    const key = eventDayKey(ev)
    if (!byKey.has(key)) {
      const g = { dayKey: key, label: dayLabel(key, now), events: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    byKey.get(key).events.push(ev)
  }
  return groups
}
