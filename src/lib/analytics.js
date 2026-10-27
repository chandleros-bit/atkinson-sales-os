// The Analytics page: a calling heatmap and lead-source results. Pure, no
// React, no I/O. Day keys are local calendar days (calendar.js dayKey), the
// same basis as Reports' call counts.
import { dayKey } from './calendar'
import { MPG_LEAD_FLOW, isLostStage } from './pipeline'
import { BAY_STAGES, bayStageFromTags } from '../../supabase/functions/_shared/bay-stages.ts'

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---- Calling heatmap ----------------------------------------------------------

// Shade relative to the busiest day shown: 0 none, then quarters of the peak.
// (Logged calls run far below the daily goal, so shading against the goal
// would paint every day the palest shade; the goal is a stat instead.)
export function heatLevel(count, peak) {
  if (!count) return 0
  if (!peak) return 4
  const f = count / peak
  return f >= 0.75 ? 4 : f >= 0.5 ? 3 : f >= 0.25 ? 2 : 1
}

// counts: { 'YYYY-MM-DD': calls }. Columns are Monday-first weeks ending with
// the week holding `now`; days after today are marked future. Returns
// { weeks: [[cell x7]], months: [{ col, label }], stats }; stats.atGoal counts
// days with at least `goal` calls.
export function heatmap(counts, { weeks = 26, goal = 0, now = Date.now() } = {}) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayKey = keyOf(today)
  const start = new Date(today)
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7)
  const startKey = keyOf(start)
  const peak = Math.max(0, ...Object.entries(counts).filter(([k]) => k >= startKey && k <= todayKey).map(([, n]) => n))

  const grid = []
  const months = []
  let lastMonth = -1
  let total = 0
  let active = 0
  let atGoal = 0
  let best = null
  for (let w = 0; w < weeks; w++) {
    const col = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      const key = keyOf(day)
      const future = key > todayKey
      const count = future ? 0 : counts[key] || 0
      if (d === 0 && day.getMonth() !== lastMonth) {
        months.push({ col: w, label: MONTHS[day.getMonth()] })
        lastMonth = day.getMonth()
      }
      if (!future) {
        total += count
        if (count > 0) active += 1
        if (goal && count >= goal) atGoal += 1
        if (count > 0 && (!best || count > best.count)) best = { key, count }
      }
      col.push({ key, count, level: future ? null : heatLevel(count, peak), future })
    }
    grid.push(col)
  }
  return { weeks: grid, months, stats: { total, active, avg: active ? Math.round(total / active) : 0, best, atGoal } }
}

// rows: outbound call activities { occurred_at } -> { 'YYYY-MM-DD': count }.
export function countByDay(rows) {
  const out = {}
  for (const r of rows) {
    if (!r.occurred_at) continue
    const k = dayKey(r.occurred_at)
    out[k] = (out[k] || 0) + 1
  }
  return out
}

// ---- Lead sources -------------------------------------------------------------

// Where a lead stands now, from its contacts row. Bayway reads the board
// column from the FUB tags (bayStageFromTags, the same rule as the board);
// a closed or past-client person stage counts as closed.
const BAY_STEP = Object.fromEntries(BAY_STAGES.map((s, i) => [s, i]))
const PARKED = 'Nurture / Credit Repair'
export function bayOutcome(row) {
  const ps = String(row.person_stage || '').trim().toLowerCase()
  if (ps === 'closed' || ps === 'past client') return 'closed'
  const stage = bayStageFromTags(row.tags, row.person_stage)
  if (stage === 'Lost' || (!stage && /trash|lost/.test(ps))) return 'lost'
  if (stage === PARKED || (!stage && ps.includes('nurture'))) return 'nurture'
  if (!stage) return 'other'
  const i = BAY_STEP[stage]
  if (i >= BAY_STEP['Application Received']) return 'received'
  if (i >= BAY_STEP['Application/Estimate Sent']) return 'app'
  if (i >= BAY_STEP['Contacted/Working']) return 'working'
  return 'new'
}

const MPG_STEP = Object.fromEntries(MPG_LEAD_FLOW.map((s, i) => [s, i]))
export function mpgOutcome(row) {
  const s = row.person_stage || ''
  if (isLostStage(s)) return 'lost'
  const i = MPG_STEP[s]
  if (i == null) return 'other'
  if (i >= MPG_STEP['Pre-Qualified']) return 'qualified'
  if (i >= MPG_STEP.Contacted) return 'contacted'
  return 'new'
}

// The table's columns per book: each counts leads whose outcome is in `of`.
// `rate` is the column the conversion percentage uses.
export const SOURCE_COLUMNS = {
  bay: {
    outcome: bayOutcome,
    cols: [
      { id: 'contacted', label: 'Contacted', of: ['working', 'app', 'received', 'closed'] },
      { id: 'apps', label: 'App / estimate', of: ['app', 'received', 'closed'] },
      { id: 'received', label: 'App received', of: ['received', 'closed'] },
      { id: 'lost', label: 'Lost', of: ['lost'] },
    ],
    rate: 'apps',
  },
  mpg: {
    outcome: mpgOutcome,
    cols: [
      { id: 'contacted', label: 'Contacted', of: ['contacted', 'qualified'] },
      { id: 'qualified', label: 'Qualified', of: ['qualified'] },
      { id: 'lost', label: 'Lost', of: ['lost'] },
    ],
    rate: 'qualified',
  },
}

const cleanSource = (s) => {
  const v = String(s ?? '').trim()
  return v && v !== '<unspecified>' ? v : 'No source'
}

// rows: contacts { business_id, source, created, person_stage, tags } for one
// book. Leads created on or after `fromMs`, grouped by source, biggest first,
// with a Total row. Partners (Realtors) aren't leads and are left out.
export function sourceTable(rows, book, fromMs) {
  const cfg = SOURCE_COLUMNS[book]
  const groups = new Map()
  const total = { source: 'Total', leads: 0, counts: {} }
  for (const r of rows) {
    if (r.business_id !== book) continue
    if (book === 'bay' && /realtor/i.test(r.person_stage || '')) continue
    const created = new Date(r.created).getTime()
    if (!r.created || Number.isNaN(created) || created < fromMs) continue
    const source = cleanSource(r.source)
    if (!groups.has(source)) groups.set(source, { source, leads: 0, counts: {} })
    const g = groups.get(source)
    const outcome = cfg.outcome(r)
    for (const target of [g, total]) {
      target.leads += 1
      for (const c of cfg.cols) if (c.of.includes(outcome)) target.counts[c.id] = (target.counts[c.id] || 0) + 1
    }
  }
  const withRate = (g) => ({ ...g, rate: g.leads ? Math.round(((g.counts[cfg.rate] || 0) / g.leads) * 100) : 0 })
  const list = [...groups.values()].sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)).map(withRate)
  return { cols: cfg.cols, rows: list, total: withRate(total) }
}
