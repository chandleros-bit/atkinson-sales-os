// Who to call today for the lead cadence (spec: Lead cadence, Nurture and
// Cold). Pure: v_dial_contacts rows in, due items out. Attempts are counted
// from the real outbound-call history, so calls made in FUB or Zoho count too.
// Times are browser-local.
//
//   attempt 1        as soon as the lead arrives
//   attempt 2        3 hours after attempt 1 (next business morning if late)
//   attempt 3        next business day, the other half of the day
//   attempts 4, 5, 6 days 3, 5 and 8 after attempt 1, 9 AM
//   Bayway after 6   "move to Nurture" (Chandler confirms; the OS never re-tags)
//   MPG after 6      two weekly nurture calls, then cold every 30 days
//   Bayway parked    Nurture: 2 weekly calls then cold; Credit Repair: every 30 days
const HOUR = 3_600_000
const DAY = 24 * HOUR
export const ATTEMPTS = 6
const NURTURE_CALLS = 2
const BAY_CADENCE = new Set(['New Lead', 'Attempted'])
const MPG_CADENCE = new Set(['Not Contacted', 'Open', 'Attempted to Contact'])
const PARKED = 'Nurture / Credit Repair'
// The text offered after each attempt (dialTexts.js keys).
const TEXT_AFTER = { 1: 'a1', 3: 'a3', 5: 'a5', 6: 'a6' }

const ms = (iso) => (iso ? new Date(iso).getTime() : null)

// Saturday or Sunday -> Monday, same time of day.
export function businessDay(t) {
  const d = new Date(t)
  if (d.getDay() === 6) d.setDate(d.getDate() + 2)
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function dayAt(from, days, hour) {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return businessDay(d.getTime())
}

// When attempt n (2..6) is due, from attempt 1's time.
export function attemptDue(n, firstAt) {
  const first = new Date(firstAt)
  if (n === 2) {
    const t = new Date(firstAt + 3 * HOUR)
    return t.toDateString() !== first.toDateString() || t.getHours() >= 20 ? dayAt(firstAt, 1, 9) : t.getTime()
  }
  if (n === 3) return dayAt(firstAt, 1, first.getHours() < 12 ? 14 : 9)
  if (n === 4) return dayAt(firstAt, 3, 9)
  if (n === 5) return dayAt(firstAt, 5, 9)
  if (n === 6) return dayAt(firstAt, 8, 9)
  return firstAt
}

const nurtureOrCold = (base, k, last) =>
  k < NURTURE_CALLS
    ? { ...base, kind: 'nurture', step: k + 1, dueAt: businessDay(last + 7 * DAY), label: `Nurture call ${k + 1} of ${NURTURE_CALLS}`, textKey: 'nurture' }
    : { ...base, kind: 'cold', step: null, dueAt: businessDay(last + 30 * DAY), label: 'Cold check-in', textKey: 'nurture' }

function parkedItem(row, base) {
  const since = ms(row.stage_since) ?? ms(row.crm_created_at) ?? 0
  const last = ms(row.last_outbound_call_at)
  const anchor = Math.max(since, last ?? 0)
  const tags = row.tags || []
  if (tags.includes('credit repair')) {
    return { ...base, kind: 'credit_repair', step: null, dueAt: businessDay(anchor + 30 * DAY), label: 'Credit repair check-in', textKey: 'credit_repair' }
  }
  if (tags.includes('nurture')) return nurtureOrCold(base, row.outbound_calls_since_stage || 0, anchor)
  return null
}

// One v_dial_contacts row -> its next cadence item, or null (not on a cadence).
export function dialItem(row, now = Date.now()) {
  const book = row.business_id
  const calls = row.outbound_calls || 0
  const first = ms(row.first_outbound_call_at)
  const last = ms(row.last_outbound_call_at)
  const base = { id: row.id, book, row, calls, hint: null }
  if (book === 'bay' && row.stage === PARKED) return parkedItem(row, base)
  const inCadence = book === 'bay' ? BAY_CADENCE.has(row.stage) : MPG_CADENCE.has(row.stage)
  if (!inCadence) return null
  const created = ms(row.crm_created_at) ?? first ?? now
  const connected = ms(row.connected_at)
  if (connected != null && connected >= created) return null
  if (calls === 0) return { ...base, kind: 'attempt', step: 1, dueAt: created, label: 'Attempt 1', hint: 'speed to lead', textKey: TEXT_AFTER[1] }
  if (calls < ATTEMPTS) {
    const step = calls + 1
    return {
      ...base,
      kind: 'attempt',
      step,
      dueAt: Math.max(attemptDue(step, first), last + 2 * HOUR),
      label: `Attempt ${step}`,
      hint: step === 3 ? (new Date(first).getHours() < 12 ? 'try afternoon' : 'try morning') : null,
      textKey: TEXT_AFTER[step] || null,
    }
  }
  if (book === 'bay') return { ...base, kind: 'move_nurture', step: ATTEMPTS, dueAt: last, label: `${ATTEMPTS} attempts, move to Nurture`, textKey: null }
  return nurtureOrCold(base, calls - ATTEMPTS, last)
}

const endOfDay = (now) => {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

// rows -> { dueNow, laterToday }. Due now: new leads (attempt 1) first, then
// oldest due first. Later today: by time. skips: contact ids off the list today.
export function buildDialList(rows, { now = Date.now(), skips = new Set(), inBook = () => true } = {}) {
  const items = (rows || [])
    .map((r) => dialItem(r, now))
    .filter((i) => i && inBook(i.book) && !skips.has(i.id) && i.dueAt <= endOfDay(now))
  const dueNow = items
    .filter((i) => i.dueAt <= now)
    .sort((a, b) => (a.kind === 'attempt' && a.step === 1 ? 0 : 1) - (b.kind === 'attempt' && b.step === 1 ? 0 : 1) || b.dueAt - a.dueAt)
  const laterToday = items.filter((i) => i.dueAt > now).sort((a, b) => a.dueAt - b.dueAt)
  return { dueNow, laterToday }
}

export function whenLabel(item, now = Date.now()) {
  if (item.dueAt > now) {
    const d = new Date(item.dueAt)
    const h = d.getHours() % 12 || 12
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
  }
  const late = Math.floor((now - item.dueAt) / DAY)
  return late >= 1 ? `${late} day${late === 1 ? '' : 's'} late` : 'due now'
}
