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

export const LOST_KEYWORDS = ['lost', 'dead', 'disengaged', 'withdrawn', 'denied']

export function isLostStage(stage) {
  const s = (stage || '').toLowerCase()
  return LOST_KEYWORDS.some((k) => s.includes(k))
}

// rows: v_active_pipeline rows ({ id, stage, last_touch_at, ... }).
// Returns ordered [{ stage, isLost, cards }] for populated stages only.
export function buildColumns(rows) {
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
    const i = LOAN_FLOW_ORDER.indexOf(col.stage)
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
