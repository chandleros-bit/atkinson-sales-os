// MPG daily tracker: pure helpers for the touch log and the copy-paste export
// into the manager's workbook (MPG_Chandler_Private_Tracker.xlsx).
// Spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md
import { localDateKey } from './crmActions'

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '')

// The last 10 digits of a US number, for dedupe. null when it isn't one.
export function phoneKey(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}

// One pasted cell. Tabs/line breaks would split the paste into extra cells, and
// Excel evaluates text starting with = + - @ as a formula ("+1 832…" too), and a
// leading " opens a quoted field that can swallow the tabs and breaks after it.
export function cellText(v) {
  if (v == null) return ''
  let s = String(v).replace(/[\t\r\n\v\f\u0085\u2028\u2029]+/g, ' · ').trim()
  if (/^[=+\-@"]/.test(s)) s = ` ${s}`
  return s
}

// 'YYYY-MM-DD' or an ISO timestamp -> 'M/D/YYYY' (the sheet's date validation
// accepts it). A timestamp counts on its local calendar day.
export function sheetDate(v) {
  if (!v) return ''
  const key = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localDateKey(new Date(v))
  const [y, m, d] = key.split('-').map(Number)
  return `${m}/${d}/${y}`
}

export const yesNo = (b) => (b ? 'Yes' : 'No')

export function contactLabel(name, role) {
  const n = trimmed(name)
  const r = trimmed(role)
  if (n && r) return `${n} / ${r}`
  return n || r || null
}

export function reachLabel(phone, email) {
  const parts = [trimmed(phone), trimmed(email)].filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

export const toTsv = (rows) => rows.map((r) => r.join('\t')).join('\n')

// The sheet's five outcome columns (Visits I–M, Follow-ups H–L), in order.
export const OUTCOMES = [
  { key: 'dm_conversation', label: 'Decision-maker conversation' },
  { key: 'statement', label: 'Statement received' },
  { key: 'demo_proposal', label: 'Demo / proposal' },
  { key: 'application', label: 'Application submitted' },
  { key: 'boarded', label: 'Merchant boarded' },
]
export const TEMPERATURES = [
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
]
const TEMP_LABEL = Object.fromEntries(TEMPERATURES.map((t) => [t.key, t.label]))
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

// True when a YYYY-MM-DD key is a real calendar day (rejects 2026-02-31).
function isRealDay(key) {
  if (!DAY_KEY.test(key || '')) return false
  const { y, m, d } = parseDayKey(key)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m, d }
}

// When a touch logged for dayKey happened: now for today, local noon for an
// earlier day (so it lands on that day in every view).
export function occurredAtFor(dayKey, now = new Date()) {
  if (dayKey === localDateKey(now)) return now.toISOString()
  const { y, m, d } = parseDayKey(dayKey)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}

// [from, to) covering one local calendar day.
export function dayRange(dayKey) {
  const { y, m, d } = parseDayKey(dayKey)
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() }
}

// form -> { prospect: mpg_prospects insert row | null, touch: mpg_touches row }.
// form.business: { type: 'new', name } | { type: 'prospect', id, name } |
//   { type: 'contact', id, name } | { type: 'edit', name } (edit: touch fields only).
// For 'new', the caller inserts the prospect first and sets touch.prospect_id.
export function buildVisit(form, now = new Date()) {
  const b = form?.business
  const name = trimmed(b?.name)
  if (!b || !name) throw new Error('Pick or type the business')
  if (!isRealDay(form.dayKey)) throw new Error('Pick the visit date')
  if (form.dayKey > localDateKey(now)) throw new Error('The visit date is in the future')
  const follow = trimmed(form.followUpOn)
  if (follow && !isRealDay(follow)) throw new Error('Follow-up date is not a date')
  const temperature = form.temperature || null
  if (temperature && !TEMP_LABEL[temperature]) throw new Error('Pick Hot, Warm or Cold')

  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o.key, !!form.outcomes?.[o.key]]))
  const fields = {
    occurred_at: occurredAtFor(form.dayKey, now),
    business_name: name,
    contact_label: contactLabel(form.contactName, form.role),
    reach_label: reachLabel(form.phone, form.email),
    notes: trimmed(form.notes) || null,
    next_step: trimmed(form.nextStep) || null,
    follow_up_on: follow || null,
    temperature,
    ...outcomes,
  }
  if (b.type === 'edit') return { prospect: null, touch: fields }

  const touch = {
    channel: 'walk_in',
    ...fields,
    contact_id: b.type === 'contact' ? b.id : null,
    prospect_id: b.type === 'prospect' ? b.id : null,
  }
  const prospect = b.type === 'new'
    ? {
        kind: 'merchant',
        business_name: name,
        contact_name: trimmed(form.contactName) || null,
        contact_role: trimmed(form.role) || null,
        phone: trimmed(form.phone) || null,
        phone_key: phoneKey(form.phone),
        email: trimmed(form.email) || null,
        temperature,
        status: 'working',
      }
    : null
  return { prospect, touch }
}

// One mpg_touches walk-in row -> Chandler Visits columns A–M.
export function visitRow(t) {
  return [
    sheetDate(t.occurred_at),
    t.business_name,
    t.contact_label,
    t.reach_label,
    t.notes,
    t.next_step,
    sheetDate(t.follow_up_on),
    TEMP_LABEL[t.temperature] || '',
    ...OUTCOMES.map((o) => yesNo(t[o.key])),
  ].map(cellText)
}

// The note dropped on a Zoho lead when a visit is logged against it.
export function zohoVisitNote(t) {
  const head = ['Walk-in']
  if (TEMP_LABEL[t.temperature]) head.push(TEMP_LABEL[t.temperature])
  const hit = OUTCOMES.filter((o) => t[o.key]).map((o) => o.label)
  if (hit.length) head.push(hit.join(', '))
  const base = head.join(' · ')
  return t.notes ? `${base} — ${t.notes}` : base
}

// Rows logged after the block was last copied (a backdated or late entry).
export function newSinceCopy(rows, copiedAtIso) {
  if (!copiedAtIso) return rows
  const t = new Date(copiedAtIso).getTime()
  return rows.filter((r) => new Date(r.created_at).getTime() > t)
}

// When a block was copied, per day, in this browser only (a convenience: losing
// it just means no "copied" hint). storage defaults to localStorage.
const copyKey = (dayKey, block) => `mpg-tracker-copied:${dayKey}:${block}`
export function readCopied(dayKey, block, storage) {
  try {
    const s = storage ?? globalThis.localStorage
    return s?.getItem(copyKey(dayKey, block)) ?? null
  } catch {
    return null
  }
}
export function writeCopied(dayKey, block, iso, storage) {
  try {
    const s = storage ?? globalThis.localStorage
    s?.setItem(copyKey(dayKey, block), iso)
  } catch {
    // private window or blocked storage: the hint is optional
  }
}
