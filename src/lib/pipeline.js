// Pure helpers for the Bayway Pipeline board. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-10-phase4-pipeline-board-design.md
import { sortByAttention } from './overview'

// Bayway columns, from the FUB tag mapping shared with crm-action
// (docs/superpowers/specs/2026-10-19-bayway-stage-tags-design.md).
import { BAY_STAGES, STAGE_TARGETS } from '../../supabase/functions/_shared/bay-stages.ts'

export const LOAN_FLOW_ORDER = BAY_STAGES

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

// How far a Bayway lead is through the dashboard's part of the loan: New Lead
// is step 1, Application Received step 5 (the LOS takes it from there).
// Nurture, Lost and unknown stages aren't on the path: null.
const BAY_PATH = BAY_STAGES.slice(0, BAY_STAGES.indexOf('Application Received') + 1)
export function stageProgress(stage) {
  const i = BAY_PATH.indexOf(stage)
  if (i < 0) return null
  return { step: i + 1, of: BAY_PATH.length, pct: Math.round(((i + 1) / BAY_PATH.length) * 100) }
}

// rows: pipeline rows ({ id, stage, last_touch_at, ... }) from v_active_pipeline
// (Bayway) or v_mpg_contacts (MPG). flowOrder curates the left-to-right column
// order for known stages; unknown-active stages follow alphabetically, lost last.
// Returns ordered [{ stage, isLost, cards }] for populated stages only, unless
// showAllFlow: then every flowOrder stage gets a column (drop targets on the
// draggable Bayway board).
// sortCards orders each column's cards (the board passes a health sort;
// default oldest touch first).
export function buildColumns(rows, flowOrder = LOAN_FLOW_ORDER, { showAllFlow = false, sortCards = sortByAttention } = {}) {
  const groups = new Map()
  if (showAllFlow) for (const stage of flowOrder) groups.set(stage, [])
  for (const r of rows) {
    const stage = (r.stage || '').trim()
    if (!stage) continue
    if (!groups.has(stage)) groups.set(stage, [])
    groups.get(stage).push(r)
  }

  const columns = [...groups.entries()].map(([stage, cards]) => ({
    stage,
    isLost: isLostStage(stage),
    cards: sortCards(cards),
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

// Dragging a Bayway card onto a column = a Move stage to that column. The
// Application/Estimate Sent column holds two tags (Smart Lists 04 / 05), so a
// drop there asks which one. null: not a Bayway column (no drop).
export function dropTargetFor(stage) {
  const targets = STAGE_TARGETS.filter((t) => t.stage === stage)
  if (targets.length === 0) return null
  if (targets.length === 1) return { key: targets[0].key }
  return { choose: targets.map((t) => ({ key: t.key, label: t.label })) }
}

// pending: { [rowId]: stage } for moves still in flight. The card shows in its
// new column (marked moving) until the server answers, then the page reloads
// or the entry is dropped to snap it back.
export function withPendingMoves(rows, pending) {
  if (!pending || Object.keys(pending).length === 0) return rows
  return rows.map((r) => (pending[r.id] ? { ...r, stage: pending[r.id], moving: true } : r))
}
