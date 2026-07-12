// Pure helpers for the Bayway Pipeline board. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-10-phase4-pipeline-board-design.md
import { sortByAttention } from './overview'

export const LOAN_FLOW_ORDER = [
  'New Lead',
  'Attempted',
  'App Sent',
  'Waiting on Docs',
  'Pre-Approved',
]

// MPG (Zoho) leads use lead-status buckets, not the loan flow. 'Open' is the
// live/new bucket in Media Payments Group's Zoho; the rest are the standard
// Zoho Leads picklist. Unknown statuses fall in alphabetically after these,
// so the board stays correct even if Chandler adds a custom status.
export const MPG_LEAD_FLOW = [
  'Not Contacted',
  'Open',
  'Attempted to Contact',
  'Contacted',
  'Contact in Future',
  'Pre-Qualified',
  'Qualified',
]

export const LOST_KEYWORDS = [
  'lost',
  'dead',
  'disengaged',
  'withdrawn',
  'denied',
  'junk',
  'unqualified',
  'not qualified',
]

export function isLostStage(stage) {
  const s = (stage || '').toLowerCase()
  return LOST_KEYWORDS.some((k) => s.includes(k))
}

// rows: pipeline rows ({ id, stage, last_touch_at, ... }) from v_active_pipeline
// (Bayway) or v_mpg_contacts (MPG). flowOrder curates the left-to-right column
// order for known stages; unknown-active stages follow alphabetically, lost last.
// Returns ordered [{ stage, isLost, cards }] for populated stages only.
export function buildColumns(rows, flowOrder = LOAN_FLOW_ORDER) {
  const groups = new Map()
  for (const r of rows) {
    const stage = (r.stage || '').trim()
    if (!stage) continue
    if (!groups.has(stage)) groups.set(stage, [])
    groups.get(stage).push(r)
  }

  const columns = [...groups.entries()].map(([stage, cards]) => ({
    stage,
    isLost: isLostStage(stage),
    cards: sortByAttention(cards),
  }))

  // Sort key [group, secondary]. group: 0 known-active, 1 unknown-active, 2 lost.
  // secondary: flow index (number) for known, stage name (string) otherwise.
  const rank = (col) => {
    if (col.isLost) return [2, col.stage]
    const i = flowOrder.indexOf(col.stage)
    return i >= 0 ? [0, i] : [1, col.stage]
  }

  return columns.sort((a, b) => {
    const [ga, sa] = rank(a)
    const [gb, sb] = rank(b)
    if (ga !== gb) return ga - gb
    if (typeof sa === 'number') return sa - sb
    return String(sa).localeCompare(String(sb))
  })
}
