// Pure helpers for the Reports scoreboard. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-13-phase12-reports-design.md
import { dayKey } from './calendar'

// One row per KPI in the Atkinson Reports doc.
// source: 'live' (computed from synced data) | 'derived' (live but caveated,
// e.g. a current-stage snapshot) | 'manual' (entered into metrics_daily).
// biz: which book the metric belongs to ('both' = personal, cross-business).
export const METRICS = [
  // ---- Daily -------------------------------------------------------------
  { key: 'calls',             label: 'Outbound calls',        tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'live_conversations',label: 'Live conversations',    tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'followups',         label: 'Follow-ups completed',  tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'new_contacts',      label: 'New contacts added',    tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'referral_asks',     label: 'Referral asks',         tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'social_minutes',    label: 'Social engagement',     tab: 'daily', biz: 'both', source: 'manual', unit: 'minutes' },
  // ---- Weekly ------------------------------------------------------------
  { key: 'realtor_convos',       label: 'Realtor conversations',       tab: 'weekly', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bizowner_convos',      label: 'Business-owner conversations',tab: 'weekly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'past_client_touches',  label: 'Past-client touches',         tab: 'weekly', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'new_referral_partners',label: 'New referral partners',       tab: 'weekly', biz: 'both',source: 'manual', unit: 'count' },
  { key: 'merchant_proposals',   label: 'Merchant proposals',          tab: 'weekly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mortgage_consults',    label: 'Mortgage consultations',      tab: 'weekly', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'weekly_conversations', label: 'Meaningful conversations',    tab: 'weekly', biz: 'both', source: 'derived', unit: 'count' },
  { key: 'calls_weekly',  label: 'Outbound calls', tab: 'weekly',  biz: 'both', source: 'derived', unit: 'count' },
  // ---- Monthly: pipeline + database -------------------------------------
  { key: 'realtor_meetings',   label: 'Realtor meetings',      tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'calls_monthly', label: 'Outbound calls', tab: 'monthly', biz: 'both', source: 'derived', unit: 'count' },
  { key: 'pre_approvals',      label: 'In pre-approval (now)', tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'applications',       label: 'In application (now)',  tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'loans_closed',       label: 'Loans closed (MTD)',    tab: 'monthly', biz: 'bay', source: 'live',    unit: 'count' },
  { key: 'loan_volume',        label: 'Loan volume (MTD)',     tab: 'monthly', biz: 'bay', source: 'live',    unit: 'currency' },
  { key: 'pipeline_value',     label: 'Pipeline value (open)', tab: 'monthly', biz: 'bay', source: 'live',    unit: 'currency' },
  { key: 'businesses_contacted',label: 'Businesses contacted', tab: 'monthly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'owner_conversations',label: 'Owner conversations',   tab: 'monthly', biz: 'mpg', source: 'manual',  unit: 'count' },
  { key: 'merchant_proposals_delivered', label: 'Proposals delivered', tab: 'monthly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'new_merchant_accounts',label: 'New merchant accounts',tab: 'monthly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'new_residual',       label: 'New residual (MTD)',    tab: 'monthly', biz: 'mpg', source: 'manual',  unit: 'currency' },
  { key: 'db_total',           label: 'Total database',        tab: 'monthly', biz: 'both',source: 'live',     unit: 'count' },
  { key: 'db_realtors',        label: 'Realtors',              tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'db_past_clients',    label: 'Past clients',          tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'db_business_owners', label: 'Business owners',       tab: 'monthly', biz: 'mpg', source: 'manual',  unit: 'count' },
  { key: 'db_prospects',       label: 'Prospects',             tab: 'monthly', biz: 'both',source: 'manual',   unit: 'count' },
  // ---- Revenue -----------------------------------------------------------
  { key: 'rev_closings',        label: 'Closings (MTD)',        tab: 'revenue', biz: 'bay', source: 'live',    unit: 'count' },
  { key: 'rev_loan_volume',     label: 'Loan volume (MTD)',     tab: 'revenue', biz: 'bay', source: 'live',    unit: 'currency' },
  { key: 'rev_gross_commission',label: 'Gross commission (MTD)',tab: 'revenue', biz: 'bay', source: 'manual',  unit: 'currency' },
  { key: 'rev_active_merchants',label: 'Active merchants',      tab: 'revenue', biz: 'mpg', source: 'manual',  unit: 'count' },
  { key: 'rev_monthly_residual',label: 'Monthly residual',      tab: 'revenue', biz: 'mpg', source: 'manual',  unit: 'currency' },
  { key: 'rev_combined_income', label: 'Combined monthly income',tab: 'revenue',biz: 'both',source: 'derived', unit: 'currency' },
  { key: 'rev_processing_volume', label: 'Processing volume',      tab: 'revenue', biz: 'mpg', source: 'manual',  unit: 'currency' },
  { key: 'rev_avg_per_closing',   label: 'Avg income / closing',   tab: 'revenue', biz: 'bay', source: 'derived', unit: 'currency' },
  { key: 'rev_avg_residual',      label: 'Avg residual / account', tab: 'revenue', biz: 'mpg', source: 'derived', unit: 'currency' },
  { key: 'rev_annualized',        label: 'Annualized income',      tab: 'revenue', biz: 'both',source: 'derived', unit: 'currency' },
  // ---- 90-day sprint -----------------------------------------------------
  { key: 'mpg_targeted_contacts',        label: 'Targeted contacts',      tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_owner_conversations',      label: 'Owner conversations',    tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_discovery_meetings',       label: 'Discovery meetings',     tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_statements_received',      label: 'Statements received',    tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_statements_analyzed',      label: 'Statements analyzed',    tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_proposals_sent',           label: 'Proposals sent',         tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_merchants_signed',         label: 'Merchants signed',       tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_merchants_activated',      label: 'Activated + processing', tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mpg_qualified_future_pipeline',label: 'Future pipeline',        tab: 'sprint', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'bay_outbound_attempts',         label: 'Outbound attempts',      tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_live_conversations',        label: 'Live conversations',     tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_completed_applications',    label: 'Completed applications', tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_qualified_preapprovals',    label: 'Qualified pre-approvals',tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_contracts_refis',           label: 'Contracts/refi opps',    tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_funded_loans',              label: 'Funded loans',           tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_referral_touches',          label: 'Referral touches',       tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_pipeline_under_contract',   label: 'Under contract baseline',tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_pipeline_preapproved',      label: 'Pre-approved baseline',  tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_pipeline_waiting_docs',     label: 'Waiting docs baseline',  tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
]

// Defaults straight from the doc. Editable at runtime via settings.metric_targets.
export const DEFAULT_TARGETS = {
  calls: 100, live_conversations: 20, followups: 25, new_contacts: 5,
  referral_asks: 3, social_minutes: 30,
  realtor_convos: 50, bizowner_convos: 50, past_client_touches: 25,
  new_referral_partners: 10, merchant_proposals: 5, mortgage_consults: 5,
  realtor_meetings: 10, pre_approvals: 20, applications: 15, loans_closed: 5,
  loan_volume: 2_000_000, pipeline_value: 2_000_000, businesses_contacted: 1000, owner_conversations: 200,
  merchant_proposals_delivered: 20, new_merchant_accounts: 5, new_residual: 1000,
  db_total: 5000, db_realtors: 500, db_past_clients: 1000,
  db_business_owners: 2000, db_prospects: 1500,
  weekly_conversations: 100,
  calls_weekly: 500, calls_monthly: 2000,
  rev_closings: 5, rev_loan_volume: 2_000_000, rev_gross_commission: 17_500,
  rev_active_merchants: 100, rev_monthly_residual: 10_000,
  rev_combined_income: 27_500, rev_processing_volume: 1_000_000,
  rev_avg_per_closing: 3_500, rev_avg_residual: 100, rev_annualized: 330_000,
  mpg_targeted_contacts: 720, mpg_owner_conversations: 180,
  mpg_discovery_meetings: 48, mpg_statements_received: 36,
  mpg_statements_analyzed: 36, mpg_proposals_sent: 24,
  mpg_merchants_signed: 10, mpg_merchants_activated: 8,
  mpg_qualified_future_pipeline: 15,
  bay_outbound_attempts: 1200, bay_live_conversations: 240,
  bay_completed_applications: 48, bay_qualified_preapprovals: 30,
  bay_contracts_refis: 16, bay_funded_loans: 10,
  bay_referral_touches: 240,
  bay_pipeline_under_contract: 1, bay_pipeline_preapproved: 3,
  bay_pipeline_waiting_docs: 8,
}

export const MPG_SPRINT = {
  from: '2026-07-30',
  to: '2026-10-29',
  label: 'July 30-Oct 28',
}

export function metricsForTab(tab, biz) {
  return METRICS.filter(
    (m) => m.tab === tab && (biz === 'all' || m.biz === 'both' || m.biz === biz),
  )
}

export function resolveTargets(defaults, savedValue) {
  const saved = savedValue && typeof savedValue === 'object' ? savedValue : {}
  return { ...defaults, ...saved }
}

export function pace(value, target) {
  if (value == null || target == null || target <= 0) return 'none'
  return value >= target ? 'on' : 'behind'
}

export function formatValue(value, unit) {
  if (value == null) return '—'
  if (unit === 'currency') return '$' + Math.round(value).toLocaleString('en-US')
  if (unit === 'minutes') return `${value}m`
  return String(value)
}

// metric: a METRICS entry. value: number | null. target: number | undefined.
export function metricCardView(metric, value, target) {
  const t = target ?? null
  const pct = value != null && t > 0 ? Math.min(100, Math.round((value / t) * 100)) : 0
  return {
    key: metric.key,
    label: metric.label,
    source: metric.source,
    unit: metric.unit,
    valueText: formatValue(value, metric.unit),
    targetText: t != null ? formatValue(t, metric.unit) : '—',
    pct,
    pace: pace(value, t),
  }
}

// metrics: METRICS subset. values: { [key]: number|null }. targets: { [key]: number }.
export function buildTabModel(metrics, values, targets = {}) {
  return metrics.map((m) => metricCardView(m, values[m.key] ?? null, targets[m.key]))
}

// Most-recent Monday (local), as a YYYY-MM-DD key matching metrics_daily.date.
export function weekStart(now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const sinceMonday = (d.getDay() + 6) % 7 // Sun=0 -> 6, Mon=1 -> 0, ...
  d.setDate(d.getDate() - sinceMonday)
  return dayKey(d.toISOString())
}

// { from, to } as YYYY-MM-DD keys: 1st of this month .. 1st of next month.
export function monthWindow(now = Date.now()) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const to = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`
  return { from, to }
}

export function sprintWindow() {
  return MPG_SPRINT
}

// rows: metrics_daily rows ({ metric_key, value }). -> { [metric_key]: sum }.
export function rollupMetrics(rows) {
  const out = {}
  for (const r of rows) out[r.metric_key] = (out[r.metric_key] || 0) + Number(r.value || 0)
  return out
}

export function sprintRows(rows, win = sprintWindow()) {
  return rows.filter((r) => String(r.date || '').slice(0, 10) >= win.from && String(r.date || '').slice(0, 10) < win.to)
}

export function weeksRemaining(win = sprintWindow(), now = Date.now()) {
  const today = dayKey(new Date(now).toISOString())
  const start = today < win.from ? win.from : today
  if (start >= win.to) return 0
  const ms = new Date(`${win.to}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()
  return Math.max(0, Math.ceil(ms / (7 * 86_400_000)))
}

export function neededPerWeek(value, target, remainingWeeks) {
  const need = Math.max(0, Number(target || 0) - Number(value || 0))
  if (!remainingWeeks) return need
  return Math.ceil((need / remainingWeeks) * 10) / 10
}

// dateStr: a 'YYYY-MM-DD' (or ISO) date. from/to: YYYY-MM-DD keys. [from, to).
// Compare as strings: expected_close is a bare DATE column, so round-tripping
// through Date()/toISOString() would shift it a day in negative-UTC-offset zones.
export function inWindow(dateStr, from, to) {
  if (!dateStr) return false
  const k = String(dateStr).slice(0, 10)
  return k >= from && k < to
}

export function sumWon(deals, { from, to }) {
  return deals
    .filter((d) => d.status === 'won' && inWindow(d.expected_close, from, to))
    .reduce((s, d) => s + Number(d.value || 0), 0)
}

export function countWon(deals, { from, to }) {
  return deals.filter((d) => d.status === 'won' && inWindow(d.expected_close, from, to)).length
}

export function pipelineValue(deals) {
  return deals.filter((d) => d.status === 'open').reduce((s, d) => s + Number(d.value || 0), 0)
}

// rows: objects with a .stage string. stageNames: array of stages to count.
export function deriveStageCounts(rows, stageNames) {
  const out = {}
  for (const name of stageNames) out[name] = 0
  for (const r of rows) {
    if (r.stage && Object.prototype.hasOwnProperty.call(out, r.stage)) out[r.stage] += 1
  }
  return out
}

// rows: metrics_daily rows ({ date, metric_key, value }), already biz-filtered.
// Returns `days` daily sums for metricKey, oldest first, ending at endKey
// (YYYY-MM-DD). Days with no matching row are 0. Powers the Daily trend strip.
export function dailySeries(rows, metricKey, endKey, days = 7) {
  const byDate = {}
  for (const r of rows) {
    if (r.metric_key !== metricKey) continue
    byDate[r.date] = (byDate[r.date] || 0) + Number(r.value || 0)
  }
  const end = new Date(endKey + 'T00:00:00')
  const pad = (n) => String(n).padStart(2, '0')
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    out.push(byDate[key] || 0)
  }
  return out
}

// rows: activity rows { occurred_at }, already filtered by the caller to
// type='call', direction='outbound', and the desired business. Returns
// { [YYYY-MM-DD]: count } using local day keys (same basis as
// metrics_daily.date via dayKey), so synced counts line up with manual entries.
export function callsByDay(rows) {
  const out = {}
  for (const r of rows) {
    if (!r.occurred_at) continue
    const key = dayKey(r.occurred_at)
    out[key] = (out[key] || 0) + 1
  }
  return out
}

// rows: activity rows { occurred_at }, already filtered by the caller to
// type='call', direction='outbound', and the desired business. fromKey: a
// YYYY-MM-DD local day key (weekStart() / monthWindow().from). Returns the count
// of rows whose local day (via dayKey) is on or after fromKey. No upper bound is
// needed — callers never fetch future-dated rows.
export function callsSince(rows, fromKey) {
  let n = 0
  for (const r of rows) {
    if (r.occurred_at && dayKey(r.occurred_at) >= fromKey) n++
  }
  return n
}

// The metrics_daily.date a tab's manual entry writes to. Rows land on the
// period's first day so the existing gte(weekStart)/gte(monthStart) rollups
// pick them up unchanged. daily -> today, weekly -> Monday, monthly/revenue
// -> the 1st.
export function periodDateFor(tab, now = Date.now()) {
  if (tab === 'daily') return dayKey(new Date(now).toISOString())
  if (tab === 'sprint') return dayKey(new Date(now).toISOString())
  if (tab === 'weekly') return weekStart(now)
  return monthWindow(now).from
}
