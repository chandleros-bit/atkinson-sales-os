// Pure helpers for the unified Tasks screen. No React, no I/O.
// Dates use the browser's local timezone (tasks are stored as UTC ISO or,
// from date-only CRM fields, as a bare date).
import { dayKey } from './calendar'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Buckets are emitted in this order and always all five, so the screen can
// render stable section headers (empty ones are skipped by the page).
export const BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'none', label: 'No due date' },
]

// Overdue gets the gold warning accent already used for the "Stale" pill.
export const BUCKET_META = {
  overdue: { color: 'var(--bay-gold)', border: 'rgba(201,160,82,.4)' },
  today: { color: 'var(--bay)', border: 'rgba(124,173,68,.4)' },
  tomorrow: { color: 'var(--muted)', border: 'var(--line)' },
  upcoming: { color: 'var(--muted)', border: 'var(--line)' },
  none: { color: 'var(--dim)', border: 'var(--line)' },
}

export const PRIORITY_META = {
  high: { label: 'High', color: '#e8785f', border: 'rgba(232,120,95,.4)' },
  normal: { label: 'Normal', color: 'var(--muted)', border: 'var(--line)' },
  low: { label: 'Low', color: 'var(--dim)', border: 'var(--line)' },
}

export const PRIORITY_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Low' },
]

// FUB and Zoho use different picklists (Zoho: Highest/High/Normal/Low/Lowest;
// FUB often none at all). Fold them into three keys, null when unknown.
export function normalizePriority(p) {
  const v = String(p || '').trim().toLowerCase()
  if (v === 'high' || v === 'highest' || v === 'urgent') return 'high'
  if (v === 'normal' || v === 'medium') return 'normal'
  if (v === 'low' || v === 'lowest') return 'low'
  return null
}

export function filterByPriority(rows, key) {
  if (!key || key === 'all') return rows
  return rows.filter((r) => normalizePriority(r.priority) === key)
}

// Both CRMs send date-only due dates (FUB `dueDate`, Zoho `Due_Date`), which
// Postgres anchors at 00:00Z when storing them in a timestamptz. Read locally,
// midnight UTC is the PREVIOUS evening anywhere west of Greenwich — every task
// would bucket a day early. A due_at sitting exactly on midnight UTC therefore
// means "this calendar date", not an instant, and must be read in UTC.
// A task genuinely due at midnight UTC is indistinguishable and gets treated
// as date-only; neither CRM sets that deliberately, so the trade is worth it.
export function isDateOnly(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
}

// dayKey for a due date: UTC for date-only values, local for real instants.
export function dueDayKey(iso) {
  if (!isDateOnly(iso)) return dayKey(iso)
  const d = new Date(iso)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}

export function dueLabel(iso, now = Date.now()) {
  if (!iso) return 'No due date'
  // Same guard as dueTimeOfDay — an unparseable value must not render as
  // "undefined · undefined NaN".
  if (Number.isNaN(new Date(iso).getTime())) return 'No due date'
  const key = dueDayKey(iso)
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const yst = new Date(now)
  yst.setDate(yst.getDate() - 1)
  if (key === todayKey) return 'Today'
  if (key === dayKey(tmr.toISOString())) return 'Tomorrow'
  if (key === dayKey(yst.toISOString())) return 'Yesterday'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// A date-only due date has no time of day — showing the clock that midnight
// UTC happens to land on locally ("7:00p") would be inventing information.
export function dueTimeOfDay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  if (isDateOnly(iso)) return '—'
  const m = d.getMinutes()
  const h24 = d.getHours()
  const ap = h24 >= 12 ? 'p' : 'a'
  const h = h24 % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ap}`
}

// rows -> the five buckets in BUCKETS order, each sorted by due_at ascending
// (so the most-overdue is on top). Comparison is by CALENDAR DAY, not
// timestamp: a task due at 9am today is still "Today" at 2pm. CRM due dates
// are often date-only, and timestamp comparison would mark them all overdue.
export function bucketByDue(rows, now = Date.now()) {
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const tomorrowKey = dayKey(tmr.toISOString())

  const groups = BUCKETS.map((b) => ({ key: b.key, label: b.label, rows: [] }))
  const byKey = new Map(groups.map((g) => [g.key, g]))

  for (const r of rows) {
    if (!r.due_at) {
      byKey.get('none').rows.push(r)
      continue
    }
    const key = dueDayKey(r.due_at)
    if (key < todayKey) byKey.get('overdue').rows.push(r)
    else if (key === todayKey) byKey.get('today').rows.push(r)
    else if (key === tomorrowKey) byKey.get('tomorrow').rows.push(r)
    else byKey.get('upcoming').rows.push(r)
  }

  for (const g of groups) {
    if (g.key === 'none') continue
    g.rows.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  }
  return groups
}
