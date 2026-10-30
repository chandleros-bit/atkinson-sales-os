// The weekday theme lists (spec: Weekday themes). Pure: v_dial_contacts rows
// in, the day's due people out. Bayway only. Each person sits on one theme
// (top partner, loan status, pre-approved, new realtor, past client, first
// match wins) and is due once their rhythm has passed since their last
// outbound call; never called is due now. Someone not reached stays due and
// shows again on the same weekday next week.
const DAY = 86_400_000
export const THEME_CAP = 15
export const THEMES = [
  { day: 1, key: 'new_realtor', label: 'New realtors' },
  { day: 2, key: 'loan_status', label: 'Loan status' },
  { day: 3, key: 'past_client', label: 'Past clients' },
  { day: 4, key: 'pre_approved', label: 'Pre-approved' },
  { day: 5, key: 'top_partner', label: 'Top partners' },
]
const BY_KEY = Object.fromEntries(THEMES.map((t) => [t.key, t]))
// New realtors: call 2 a week after the intro, call 3 two weeks later, then monthly.
const REALTOR_GAPS = [7, 14, 30]
const GAP_DAYS = { loan_status: 6, past_client: 90, pre_approved: 7, top_partner: 14 }
const LABEL = { loan_status: 'Loan status update', past_client: 'Past client check-in', pre_approved: 'Pre-approval check-in', top_partner: 'Partner check-in' }
const NEW_REALTOR_DAYS = 90
const OFF_BOARD = new Set(['Lost', 'Nurture / Credit Repair'])

const ms = (iso) => (iso ? new Date(iso).getTime() : null)
const days = (from, now) => Math.floor((now - from) / DAY)

export const themeForDay = (weekday) => THEMES.find((t) => t.day === weekday) || null

// Which theme a person is on, or null.
export function themeOf(row, now = Date.now()) {
  if (row.business_id !== 'bay') return null
  const tags = row.tags || []
  if (tags.includes('top partner')) return 'top_partner'
  const onBoard = row.stage && !OFF_BOARD.has(row.stage)
  if (onBoard && (row.stage === 'Disclosed' || tags.includes('under contract'))) return 'loan_status'
  if (onBoard && tags.includes('pre-approved')) return 'pre_approved'
  const created = ms(row.crm_created_at)
  if (row.person_stage === 'Realtors' && created != null && now - created <= NEW_REALTOR_DAYS * DAY) return 'new_realtor'
  if (row.person_stage === 'Closed' || row.person_stage === 'Past Client') return 'past_client'
  return null
}

// A person -> their theme item (due date, label, hint), or null.
export function themeItem(row, now = Date.now()) {
  const kind = themeOf(row, now)
  if (!kind) return null
  const calls = row.outbound_calls || 0
  const last = ms(row.last_outbound_call_at)
  const base = { id: row.id, book: 'bay', row, calls, kind, theme: kind, step: null, textKey: kind }
  const lastHint = last == null ? 'never called' : `last call ${days(last, now)} days ago`
  if (kind === 'new_realtor') {
    const dueAt = calls === 0 || last == null ? ms(row.crm_created_at) : last + REALTOR_GAPS[Math.min(calls, REALTOR_GAPS.length) - 1] * DAY
    return { ...base, dueAt, label: calls === 0 ? 'New realtor · intro call' : `New realtor · call ${calls + 1}`, hint: lastHint }
  }
  let hint = lastHint
  if (kind === 'pre_approved') {
    const since = ms(row.pre_approved_at)
    const age = since == null ? null : days(since, now)
    if (age != null && age >= 60) hint = `${lastHint} · pre-approved ${age} days, refresh letter`
  }
  return { ...base, dueAt: last == null ? 0 : last + GAP_DAYS[kind] * DAY, label: LABEL[kind], hint }
}

const endOfDay = (t) => {
  const d = new Date(t)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

// The date of `weekday` (1-5) in now's Monday-Friday week.
function dateOfWeekday(now, weekday) {
  const d = new Date(now)
  const today = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() + (weekday - today))
  return d.getTime()
}

// rows -> { theme, items (capped), total, week }. day: preview another weekday
// (1-5), evaluated as of that day this week; default today. week: each
// weekday's theme with how many people are due by then.
export function buildThemeList(rows, { now = Date.now(), day = null, skips = new Set(), inBook = () => true, cap = THEME_CAP } = {}) {
  const items = inBook('bay') ? (rows || []).map((r) => themeItem(r, now)).filter((i) => i && !skips.has(i.id)) : []
  const dueBy = (key, t) => items.filter((i) => i.kind === key && i.dueAt <= endOfDay(t))
  const todayDay = new Date(now).getDay()
  const week = THEMES.map((t) => ({ ...t, count: dueBy(t.key, dateOfWeekday(now, t.day)).length, isToday: t.day === todayDay }))
  const theme = themeForDay(day ?? todayDay)
  if (!theme) return { theme: null, items: [], total: 0, week }
  const due = dueBy(theme.key, day == null ? now : dateOfWeekday(now, day)).sort((a, b) => a.dueAt - b.dueAt)
  return { theme, items: due.slice(0, cap), total: due.length, week }
}

export const themeLabel = (key) => BY_KEY[key]?.label || null
