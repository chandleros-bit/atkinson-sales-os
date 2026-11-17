// Pure helpers for the Bayway Pipeline board. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-10-phase4-pipeline-board-design.md
import { sortByAttention } from './overview'

// Bayway columns, from the FUB tag mapping shared with crm-action
// (docs/superpowers/specs/2026-10-19-bayway-stage-tags-design.md).
import { BAY_STAGES, STAGE_TARGETS } from '../../supabase/functions/_shared/bay-stages.ts'
import { MPG_STAGES, MPG_STAGE_TARGETS } from '../../supabase/functions/_shared/mpg-stages.ts'

export const LOAN_FLOW_ORDER = BAY_STAGES

// MPG (Zoho) columns: Zoho's Lead Status, normalized to these labels
// (supabase/functions/_shared/mpg-stages.ts, shared with crm-action). Unknown
// statuses fall in alphabetically after these.
export const MPG_LEAD_FLOW = MPG_STAGES

export const LOST_KEYWORDS = [
  'lost',
  'dead',
  'disengaged',
  'withdrawn',
  'denied',
  'junk',
  'unqualified',
  'not qualified',
  // MPG's Closed Non-Compatible.
  'non-compatible',
]

export function isLostStage(stage) {
  const s = (stage || '').toLowerCase()
  return LOST_KEYWORDS.some((k) => s.includes(k))
}

// How far a lead is along its book's path. Bayway: New Lead is step 1,
// Application Received step 5 (the LOS takes it from there). MPG: Not
// Contacted to Approved. Nurture, Lost, Closed and unknown stages aren't on
// the path: null. Stage names don't overlap between the books.
const BAY_PATH = BAY_STAGES.slice(0, BAY_STAGES.indexOf('Application Received') + 1)
const MPG_PATH = MPG_STAGES.slice(0, MPG_STAGES.indexOf('Approved') + 1)
export function stageProgress(stage) {
  for (const [book, path] of [['bay', BAY_PATH], ['mpg', MPG_PATH]]) {
    const i = path.indexOf(stage)
    if (i >= 0) return { step: i + 1, of: path.length, pct: Math.round(((i + 1) / path.length) * 100), book }
  }
  return null
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

// Dragging a card onto a column = a Move stage to that column. Two Bayway
// columns hold two tags each, so a drop there asks which one:
// Application/Estimate Sent (Smart Lists 04 / 05) and Nurture / Credit Repair.
// Every MPG column is one Zoho Lead Status. null: not a column of that book
// (no drop).
export function dropTargetFor(stage, book = 'bay') {
  const targets = (book === 'mpg' ? MPG_STAGE_TARGETS.map((t) => ({ ...t, stage: t.label })) : STAGE_TARGETS)
    .filter((t) => t.stage === stage)
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
