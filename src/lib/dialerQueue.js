// Power Dialer queue rules (spec 2026-11-20, "Data model" and "Dial screen").
// Pure: the outcome table, the retry schedule and which lead comes next.

// key, label, counts as a connect, lead status after, business it is limited to.
export const OUTCOMES = [
  { key: 'no_answer', label: 'No answer', connect: false, status: 'retry' },
  { key: 'voicemail', label: 'Left voicemail', connect: false, status: 'retry' },
  { key: 'owner_unavailable', label: 'Owner not available', connect: true, status: 'retry', biz: 'mpg' },
  { key: 'bad_number', label: 'Bad number', connect: false, status: 'invalid_phone' },
  { key: 'not_interested', label: 'Not interested', connect: true, status: 'dead' },
  { key: 'do_not_call', label: 'Do Not Call', connect: true, status: 'dnc' },
  { key: 'callback_requested', label: 'Callback requested', connect: true, status: 'confirmed' },
  { key: 'interested', label: 'Interested', connect: true, status: 'confirmed' },
  { key: 'appointment_set', label: 'Appointment set', connect: true, status: 'confirmed' },
  { key: 'application_sent', label: 'Application sent', connect: true, status: 'confirmed', biz: 'bay' },
]
const BY_KEY = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]))

export const outcome = (key) => BY_KEY[key] || null
export const outcomesFor = (business) => OUTCOMES.filter((o) => !o.biz || o.biz === business)
export const needsPush = (key) => BY_KEY[key]?.status === 'confirmed'

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_MIN_RETRY_HOURS = 4

// Halves of the calling day, local time: morning 9-12, afternoon 12-20.
const HALVES = { am: [9, 12], pm: [12, 20] }
const HOUR = 3600_000

// The next attempt: at least minHours later, in the other half of the day
// from the miss (a morning miss retries in the afternoon, and the reverse).
export function nextAttemptAt(now, minHours = DEFAULT_MIN_RETRY_HOURS) {
  const missed = new Date(now)
  const target = missed.getHours() < 12 ? 'pm' : 'am'
  const earliest = now + minHours * HOUR
  const [from, to] = HALVES[target]
  for (let d = 0; d < 7; d++) {
    const start = new Date(missed.getFullYear(), missed.getMonth(), missed.getDate() + d, from).getTime()
    const end = new Date(missed.getFullYear(), missed.getMonth(), missed.getDate() + d, to).getTime()
    const t = Math.max(start, earliest)
    if (t < end) return t
  }
  return earliest
}

// The lead update after an outcome is logged. Every logged outcome counts as
// an attempt; a retry outcome on the last allowed attempt ends the lead.
export function applyOutcome(lead, key, { now = Date.now(), maxAttempts = DEFAULT_MAX_ATTEMPTS, minHours = DEFAULT_MIN_RETRY_HOURS } = {}) {
  const o = BY_KEY[key]
  if (!o) throw new Error(`Unknown outcome: ${key}`)
  const attempt_count = (lead.attempt_count || 0) + 1
  let status = o.status
  let next = null
  if (status === 'retry') {
    if (attempt_count >= maxAttempts) status = 'dead'
    else next = new Date(nextAttemptAt(now, minHours)).toISOString()
  }
  return { status, attempt_count, last_outcome: key, next_attempt_at: next }
}

// Queued leads in CSV order first, then retries whose time has come, earliest
// due first. skip: lead ids passed over in this session.
export function nextLead(leads, { now = Date.now(), skip = new Set() } = {}) {
  const open = leads.filter((l) => !skip.has(l.id))
  const queued = open.filter((l) => l.status === 'queued').sort((a, b) => a.position - b.position)
  if (queued.length) return queued[0]
  const due = open
    .filter((l) => l.status === 'retry' && l.next_attempt_at && Date.parse(l.next_attempt_at) <= now)
    .sort((a, b) => Date.parse(a.next_attempt_at) - Date.parse(b.next_attempt_at) || a.position - b.position)
  return due[0] || null
}
