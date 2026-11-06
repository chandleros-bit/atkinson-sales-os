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
// Excel evaluates text starting with = + - @ as a formula ("+1 832…" too).
export function cellText(v) {
  if (v == null) return ''
  let s = String(v).replace(/[\t\r\n]+/g, ' · ').trim()
  if (/^[=+\-@]/.test(s)) s = ` ${s}`
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
