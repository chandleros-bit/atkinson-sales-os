// Up Next: who to call next, and why. Pure ranking over v_lead_signals rows
// (migration 0029). Every rule is checked; a lead shows once, under its
// highest bucket, with its other reasons as chips. It leaves the list when the
// reason is resolved (a call or note logged, a task scheduled, the stage
// moved), never by a "mark done". See
// docs/superpowers/specs/2026-10-18-priority-queue-design.md.
//
// Days are the rep's local calendar days (dayKey), the same convention as the
// Tasks board; date-only task dues are read as their calendar date (dueDayKey).
import { dayKey } from './calendar'
import { dueDayKey } from './tasks'
import { isLostStage } from './pipeline'

export const BUCKETS = [
  { id: 'reached_out', label: 'They reached out' },
  { id: 'new_lead', label: 'New, not yet called' },
  { id: 'overdue', label: 'Follow-up overdue' },
  { id: 'hot_cold', label: 'Hot, going cold' },
  { id: 'no_next_step', label: 'No next step' },
  { id: 'stuck', label: 'Stuck in stage' },
  { id: 'quiet', label: 'Gone quiet' },
]
const RANK = Object.fromEntries(BUCKETS.map((b, i) => [b.id, i]))
export const BUCKET_LABEL = Object.fromEntries(BUCKETS.map((b) => [b.id, b.label]))

// Buckets 1-3: "act now". The sidebar badge counts only these.
export const URGENT = new Set(['reached_out', 'new_lead', 'overdue'])

// Mirrors the settings.priority_rules row seeded in 0029.
export const DEFAULT_RULES = {
  new_lead_days: 7,
  hot_cold_days: 3,
  quiet_days: 7,
  stuck_days: 14,
  // Days in one Bayway column before a lead is "stuck" (board card turns red,
  // Up Next bucket 6). null = never. Stages not listed (MPG, unknown) use
  // stuck_days. Mirrored into settings by migration 0034.
  stuck_days_by_stage: {
    'New Lead': 2,
    Attempted: 5,
    'Contacted/Working': 7,
    'Application/Estimate Sent': 7,
    'Application Received': 14,
    // Waiting on closing, tracked in the Workbench Disclosed group.
    Disclosed: null,
    'Nurture / Credit Repair': null,
  },
  // Minutes before a new, uncalled lead's timer turns red (board + tab title).
  speed_to_lead_minutes: 5,
  daily_cap: 15,
  use_crm_last_activity_fallback: true,
  mpg_active_statuses: ['Open', 'Pending', 'Initial lead follow up'],
  mpg_hot_statuses: [],
  mpg_dead_statuses: [],
  bay_partner_stages: ['Realtors'],
  bay_excluded_stages: ['Nurture', 'Closed', 'Lost'],
}

export function resolveRules(saved) {
  return { ...DEFAULT_RULES, ...(saved || {}) }
}

// Days in `stage` before a lead counts as stuck, or null for never.
export function stuckDaysFor(stage, rules) {
  const byStage = rules.stuck_days_by_stage || {}
  return Object.prototype.hasOwnProperty.call(byStage, stage) ? byStage[stage] : rules.stuck_days
}

const ms = (iso) => (iso ? new Date(iso).getTime() : NaN)
const later = (a, b) => (!a ? b || null : !b ? a : ms(a) >= ms(b) ? a : b)

// Whole local calendar days from `iso` to `now` (0 = same day).
function daysSince(iso, now) {
  if (!iso) return null
  const k = (key) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d) / 86400000
  }
  return k(dayKey(new Date(now).toISOString())) - k(dayKey(iso))
}

function overdueDays(dueIso, now) {
  if (!dueIso) return null
  const [y, m, d] = dueDayKey(dueIso).split('-').map(Number)
  const [ty, tm, td] = dayKey(new Date(now).toISOString()).split('-').map(Number)
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000
}

// Latest human touch: logged outbound call / note / appointment or inbound
// call, plus (opt-in) the CRM's own last-activity date. Never last_touch_at.
export function humanTouchAt(row, rules) {
  const logged = later(row.last_outbound_at, row.last_inbound_at)
  return rules.use_crm_last_activity_fallback ? later(logged, row.crm_last_activity_at) : logged
}

function isExcluded(row) {
  return isLostStage(row.stage) || /nurture/i.test(row.stage || '')
}

const reachedOut = (row) =>
  !!row.last_inbound_at && (!row.last_outbound_at || ms(row.last_inbound_at) > ms(row.last_outbound_at))

// Every bucket id that fires for this row, in rank order.
export function bucketsFor(row, rules, now = Date.now()) {
  if (isExcluded(row)) return []
  const out = []
  if (reachedOut(row)) out.push('reached_out')
  // Partners (realtors) are only surfaced when they call in.
  if (row.is_partner) return out

  const createdDays = daysSince(row.crm_created_at, now)
  if (createdDays != null && createdDays <= rules.new_lead_days && !row.last_outbound_call_at) out.push('new_lead')

  const od = row.open_task_count > 0 ? overdueDays(row.oldest_open_due_at, now) : null
  if (od != null && od >= 1) out.push('overdue')

  const touchDays = daysSince(humanTouchAt(row, rules), now)
  const untouchedFor = (n) => touchDays == null || touchDays >= n
  if (row.is_hot && untouchedFor(rules.hot_cold_days)) out.push('hot_cold')
  if (row.is_active && !(row.open_task_count > 0)) out.push('no_next_step')
  const stageDays = daysSince(row.stage_since, now)
  const stuckLimit = stuckDaysFor(row.stage, rules)
  if (row.is_active && stuckLimit != null && stageDays != null && stageDays >= stuckLimit) out.push('stuck')
  if (row.is_active && untouchedFor(rules.quiet_days)) out.push('quiet')
  return out
}

// How badly this row is neglected for its bucket; bigger sorts first.
function neglect(row, now) {
  switch (row.bucket) {
    case 'reached_out':
      return now - ms(row.last_inbound_at)
    case 'new_lead':
      return ms(row.crm_created_at) // newest first: minutes matter most
    case 'overdue':
      return now - ms(row.oldest_open_due_at)
    case 'stuck':
      return now - ms(row.stage_since)
    default:
      return row.touchAt ? now - ms(row.touchAt) : Number.MAX_SAFE_INTEGER
  }
}

// rows: v_lead_signals rows. Returns queue rows sorted worst first:
// { ...row, bucket, reasons, touchAt, daysNeglected, decide }.
export function buildQueue(rows, rules, now = Date.now()) {
  const out = []
  for (const row of rows || []) {
    const reasons = bucketsFor(row, rules, now)
    if (!reasons.length) continue
    const touchAt = humanTouchAt(row, rules)
    out.push({
      ...row,
      bucket: reasons[0],
      reasons,
      touchAt,
      daysNeglected: daysSince(touchAt, now),
      decide: (row.snooze_count_60d || 0) >= 3,
    })
  }
  return out.sort((a, b) => {
    if (a.bucket !== b.bucket) return RANK[a.bucket] - RANK[b.bucket]
    const n = neglect(b, now) - neglect(a, now)
    if (n) return n
    const s = (b.score ?? -1) - (a.score ?? -1)
    if (s) return s
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

// First `cap` rows grouped under their bucket headings, plus per-bucket
// counts across the whole queue.
export function groupForDisplay(queue, cap) {
  const visible = queue.slice(0, cap)
  const counts = {}
  for (const r of queue) counts[r.bucket] = (counts[r.bucket] || 0) + 1
  const groups = BUCKETS.map((b) => ({ ...b, rows: visible.filter((r) => r.bucket === b.id) })).filter(
    (g) => g.rows.length,
  )
  return { visible, hiddenCount: queue.length - visible.length, counts, groups }
}

export function urgentCount(queue) {
  return queue.filter((r) => URGENT.has(r.bucket)).length
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function agoShort(iso, now) {
  const mins = Math.max(0, Math.round((now - ms(iso)) / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

// The row's main reason, in plain words.
export function reasonText(row, now = Date.now()) {
  switch (row.bucket) {
    case 'reached_out':
      return `Called you ${agoShort(row.last_inbound_at, now)} ago, no callback`
    case 'new_lead': {
      const mins = Math.max(0, Math.floor((now - ms(row.crm_created_at)) / 60000))
      if (mins < 60) return `New lead · ${mins}m, not called`
      const hrs = Math.max(0, Math.round((now - ms(row.crm_created_at)) / 3600000))
      return hrs < 48 ? `New lead · ${plural(hrs, 'hour')}, not called` : `New lead · ${plural(daysSince(row.crm_created_at, now), 'day')}, not called`
    }
    case 'overdue':
      return `Follow-up ${plural(overdueDays(row.oldest_open_due_at, now), 'day')} overdue`
    case 'hot_cold': {
      const d = daysSince(row.touchAt, now)
      return d == null ? 'HOT · no touch logged' : `HOT · ${plural(d, 'day')} since last touch`
    }
    case 'no_next_step':
      return `${row.stage || 'Active'} · no next step`
    case 'stuck':
      return `In ${row.stage || 'this stage'} for ${plural(daysSince(row.stage_since, now), 'day')}`
    case 'quiet': {
      const d = daysSince(row.touchAt, now)
      return d == null ? 'No touch logged' : `${plural(d, 'day')} since last touch`
    }
    default:
      return ''
  }
}

export function lastCallLabel(row, now = Date.now()) {
  const d = daysSince(row.last_outbound_call_at, now)
  if (d == null) return 'No calls logged'
  return d === 0 ? 'Last call today' : `Last call ${d}d ago`
}

// Shared with the board's card health (cardHealth.js) so both count days alike.
export { daysSince as calendarDaysSince, overdueDays }
