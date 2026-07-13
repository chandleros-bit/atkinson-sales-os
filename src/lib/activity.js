// Pure helpers for the Activity feed. No React, no I/O.
// Dates use the browser's local timezone (activities are stored as UTC ISO).
import { dayKey } from './calendar'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Per-type presentation. Colors come from the token system where possible;
// text/email/appt use fixed hues (blue/gold/violet) that read on the dark chrome.
export const TYPE_META = {
  call: { label: 'Call', color: 'var(--bay)', border: 'rgba(124,173,68,.4)' },
  text: { label: 'Text', color: '#5FA8D3', border: 'rgba(95,168,211,.4)' },
  email: { label: 'Email', color: 'var(--bay-gold)', border: 'rgba(201,160,82,.4)' },
  note: { label: 'Note', color: 'var(--muted)', border: 'var(--line)' },
  appointment: { label: 'Appt', color: '#B08BD9', border: 'rgba(176,139,217,.4)' },
}

export const TYPE_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'text', label: 'Texts' },
  { key: 'email', label: 'Emails' },
  { key: 'note', label: 'Notes' },
  { key: 'appointment', label: 'Appts' },
]

export function filterByType(rows, typeKey) {
  if (!typeKey || typeKey === 'all') return rows
  return rows.filter((r) => r.type === typeKey)
}

export function activityDayLabel(iso, now = Date.now()) {
  const key = dayKey(iso)
  const todayKey = dayKey(new Date(now).toISOString())
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const yesterdayKey = dayKey(y.toISOString())
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function timeOfDay(iso) {
  const d = new Date(iso)
  const m = d.getMinutes()
  let h = d.getHours()
  const ap = h >= 12 ? 'p' : 'a'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ap}`
}

// rows -> ordered [{ dayKey, label, rows }], most-recent day first, rows within
// each day sorted newest-first. Rows without occurred_at are dropped.
export function groupByDay(rows, now = Date.now()) {
  const sorted = [...rows]
    .filter((r) => r.occurred_at)
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
  const byKey = new Map()
  const groups = []
  for (const r of sorted) {
    const key = dayKey(r.occurred_at)
    if (!byKey.has(key)) {
      const g = { dayKey: key, label: activityDayLabel(r.occurred_at, now), rows: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    byKey.get(key).rows.push(r)
  }
  return groups
}
