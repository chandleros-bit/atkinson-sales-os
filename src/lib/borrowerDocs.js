// Pure helpers for the borrower-docs block on Bayway pipeline cards.
// No React, no I/O. Doc data arrives on v_active_pipeline rows (migration 0022)
// and is null/empty for MPG.
import { daysSince, STALE_TOUCH_DAYS } from './overview'

// The board keeps ONE notion of "too long": the docs badge goes amber on the
// same threshold the stale-touch pill already uses.
export const DOC_AGING_DAYS = STALE_TOUCH_DAYS

// How many doc names fit on a card before overflowing to "+N".
const NAMES_SHOWN = 2

// 'untracked' (absent from the sheet) is deliberately distinct from 'clear'
// (in the sheet, owes nothing). Collapsing them would let a borrower nobody has
// entered read as "all docs received", which is confidently wrong.
export function docsState(row) {
  if (!row?.docs_tracked) return 'untracked'
  return (row.docs_outstanding_count || 0) > 0 ? 'outstanding' : 'clear'
}

export function docSummary(names) {
  const list = Array.isArray(names) ? names : []
  if (list.length === 0) return ''
  const head = list.slice(0, NAMES_SHOWN).join(', ')
  const rest = list.length - NAMES_SHOWN
  return rest > 0 ? `${head} +${rest}` : head
}

export function isDocAging(oldestRequestedAt, now = Date.now()) {
  const d = daysSince(oldestRequestedAt, now)
  return d !== null && d >= DOC_AGING_DAYS
}
