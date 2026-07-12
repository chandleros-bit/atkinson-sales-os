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

export function dayLabel(iso, now = Date.now()) {
  const key = dayKey(iso)
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const tomorrowKey = dayKey(tmr.toISOString())
  if (key === todayKey) return 'Today'
  if (key === tomorrowKey) return 'Tomorrow'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`
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
    const key = dayKey(ev.starts_at)
    if (!byKey.has(key)) {
      const g = { dayKey: key, label: dayLabel(ev.starts_at, now), events: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    byKey.get(key).events.push(ev)
  }
  return groups
}
