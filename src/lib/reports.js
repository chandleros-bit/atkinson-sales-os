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
  // ---- Monthly: pipeline + database -------------------------------------
  { key: 'realtor_meetings',   label: 'Realtor meetings',      tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'pre_approvals',      label: 'In pre-approval (now)', tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'applications',       label: 'In application (now)',  tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'loans_closed',       label: 'Loans closed (MTD)',    tab: 'monthly', biz: 'bay', source: 'live',    unit: 'count' },
  { key: 'loan_volume',        label: 'Loan volume (MTD)',     tab: 'monthly', biz: 'bay', source: 'live',    unit: 'currency' },
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
]

// Defaults straight from the doc. Editable at runtime via settings.metric_targets.
export const DEFAULT_TARGETS = {
  calls: 100, live_conversations: 20, followups: 25, new_contacts: 5,
  referral_asks: 3, social_minutes: 30,
  realtor_convos: 50, bizowner_convos: 50, past_client_touches: 25,
  new_referral_partners: 10, merchant_proposals: 5, mortgage_consults: 5,
  realtor_meetings: 10, pre_approvals: 20, applications: 15, loans_closed: 5,
  loan_volume: 2_000_000, businesses_contacted: 1000, owner_conversations: 200,
  merchant_proposals_delivered: 20, new_merchant_accounts: 5, new_residual: 1000,
  db_total: 5000, db_realtors: 500, db_past_clients: 1000,
  db_business_owners: 2000, db_prospects: 1500,
  rev_closings: 5, rev_loan_volume: 2_000_000, rev_gross_commission: 17_500,
  rev_active_merchants: 100, rev_monthly_residual: 10_000,
  rev_combined_income: 27_500,
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

// rows: metrics_daily rows ({ metric_key, value }). -> { [metric_key]: sum }.
export function rollupMetrics(rows) {
  const out = {}
  for (const r of rows) out[r.metric_key] = (out[r.metric_key] || 0) + Number(r.value || 0)
  return out
}

// dateStr: an ISO date/timestamp. from/to: YYYY-MM-DD keys. [from, to).
export function inWindow(dateStr, from, to) {
  if (!dateStr) return false
  const k = dayKey(new Date(dateStr).toISOString())
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
