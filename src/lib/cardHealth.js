// Pipeline card health: is this lead moving? Pure, no React, no I/O.
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (1, 2)
//
// Days are the rep's local calendar days, via the same helpers Up Next uses,
// so a red card on the board and an Up Next row always agree.
import { dueDayKey } from './tasks'
import { calendarDaysSince, overdueDays, stuckDaysFor } from './priorityQueue'
import { isLostStage } from './pipeline'
import { sortByAttention } from './overview'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Parked (Nurture / Credit Repair) and lost leads aren't expected to move.
const isParked = (row) => /nurture/i.test(row.stage || '') || isLostStage(row.stage)

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// The lead's next step, from its oldest open task.
// { state: 'overdue' | 'today' | 'scheduled' | 'none' | 'parked', text }
export function nextStep(row, now = Date.now()) {
  if (isParked(row)) return { state: 'parked', text: '' }
  if (!(row.open_task_count > 0)) return { state: 'none', text: 'No next step' }
  if (!row.oldest_open_due_at) return { state: 'scheduled', text: 'Task open · no date' }
  const late = overdueDays(row.oldest_open_due_at, now)
  if (late >= 1) return { state: 'overdue', text: `Follow-up ${plural(late, 'day')} overdue` }
  if (late === 0) return { state: 'today', text: 'Due today' }
  return { state: 'scheduled', text: `Next: ${dayLabel(dueDayKey(row.oldest_open_due_at))}` }
}

// { days, text } once the lead has sat in its stage for the stage's limit.
// Unknown stage dates (stage predates tracking, 0029) are never stuck.
export function stuckFor(row, rules, now = Date.now()) {
  if (isParked(row)) return null
  const limit = stuckDaysFor(row.stage, rules)
  const days = calendarDaysSince(row.stage_since, now)
  if (limit == null || days == null || days < limit) return null
  return { days, text: `${days}d in ${row.stage}` }
}

// The first column of each book, where a new lead's next step is the first call.
export const SPEED_STAGES = new Set(['New Lead', 'Not Contacted', 'Open'])

export function formatElapsed(minutes) {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }
  return `${Math.floor(minutes / 1440)}d`
}

// Speed-to-lead: wall-clock time since the lead arrived, until the first
// outbound call. Same window as Up Next's "New, not yet called" bucket.
// { minutes, late, text } or null.
export function speedToLead(row, rules, now = Date.now()) {
  if (!SPEED_STAGES.has(row.stage) || row.last_outbound_call_at || !row.crm_created_at) return null
  const created = new Date(row.crm_created_at).getTime()
  if (Number.isNaN(created)) return null
  if (calendarDaysSince(row.crm_created_at, now) > rules.new_lead_days) return null
  const minutes = Math.max(0, Math.floor((now - created) / 60000))
  return { minutes, late: minutes >= rules.speed_to_lead_minutes, text: `${formatElapsed(minutes)} · not called` }
}

export function cardHealth(row, rules, now = Date.now()) {
  return { next: nextStep(row, now), stuck: stuckFor(row, rules, now), speed: speedToLead(row, rules, now) }
}

// Smaller sorts first: uncalled new leads (late, then fresh), then overdue,
// stuck, no next step, due today, scheduled.
const NEXT_RANK = { overdue: 0, none: 2, today: 3, scheduled: 4, parked: 5 }
export function healthRank(h) {
  if (h.speed) return h.speed.late ? -2 : -1
  if (h.next.state === 'overdue') return 0
  if (h.stuck) return 1
  return NEXT_RANK[h.next.state]
}

// Board order inside a column. Ties keep the old oldest-touch-first order
// (Array.prototype.sort is stable).
export function sortByHealth(cards, rules, now = Date.now()) {
  const rank = new Map(cards.map((r) => [r, healthRank(cardHealth(r, rules, now))]))
  return sortByAttention(cards).sort((a, b) => rank.get(a) - rank.get(b))
}

// "4 overdue · 2 stuck" for a column header; '' when nothing needs saying.
export function columnSummary(cards, rules, now = Date.now()) {
  let overdue = 0
  let stuck = 0
  for (const r of cards) {
    const h = cardHealth(r, rules, now)
    if (h.next.state === 'overdue') overdue += 1
    if (h.stuck) stuck += 1
  }
  return [overdue && `${overdue} overdue`, stuck && `${stuck} stuck`].filter(Boolean).join(' · ')
}

// How many new, uncalled leads are past speed_to_lead_minutes (any book).
export function lateLeadCount(rows, rules, now = Date.now()) {
  return (rows || []).filter((r) => speedToLead(r, rules, now)?.late).length
}

export const APP_TITLE = 'Atkinson Sales OS'
export function titleFor(late) {
  if (!late) return APP_TITLE
  return `(${late}) New lead${late === 1 ? '' : 's'} waiting · ${APP_TITLE}`
}
