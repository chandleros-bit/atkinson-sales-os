// Pure helpers for the Reports scoreboard. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-13-phase12-reports-design.md
import { dayKey, keyDaysBetween } from './calendar'

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
  { key: 'pre_approvals',      label: 'Application received (now)', tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'applications',       label: 'App / estimate sent (now)', tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
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
  { key: 'rev_gross_commission',label: 'Gross commission (MTD)',tab: 'revenue', biz: 'bay', source: 'live',    unit: 'currency' },
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
  { key: 'bay_funded_loans',              label: 'Funded loans',           tab: 'sprint', biz: 'bay', source: 'live', unit: 'count' },
  { key: 'bay_referral_touches',          label: 'Referral touches',       tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_pipeline_under_contract',   label: 'Under contract baseline',tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_pipeline_preapproved',      label: 'Pre-approved baseline',  tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bay_pipeline_waiting_docs',     label: 'Waiting docs baseline',  tab: 'sprint', biz: 'bay', source: 'manual', unit: 'count' },
]

// Metrics read from the Arive loans import (src/lib/loans.js loanStats).
export const ARIVE_KEYS = ['loans_closed', 'loan_volume', 'pipeline_value', 'rev_closings', 'rev_loan_volume', 'rev_gross_commission', 'bay_funded_loans']

// Revenue cards derived from commission: before the first import they carry
// the same "no Arive import yet" note on the Bayway and all views.
const DERIVED_FROM_COMMISSION = ['rev_combined_income', 'rev_annualized', 'rev_avg_per_closing']

// stats: loanStats() from loans.js (null when nothing is imported). Takes the
// computed stats rather than the loans because loans.js imports this file.
// Bayway's Arive numbers never count on the MPG view.
export function ariveValues(stats, biz = 'all') {
  if (!stats || biz === 'mpg') return Object.fromEntries(ARIVE_KEYS.map((k) => [k, null]))
  return {
    loans_closed: stats.closed, loan_volume: stats.volume, pipeline_value: stats.pipeline,
    rev_closings: stats.closed, rev_loan_volume: stats.volume, rev_gross_commission: stats.commission,
    bay_funded_loans: stats.sprintFunded,
  }
}

// Card sublines saying where the Arive numbers came from. lastImport: the
// latest ok arive sync_log row ({ ran_at }) or null.
export function ariveNotes({ loans = [], lastImport = null, biz = 'all' }) {
  if (biz === 'mpg') return {}
  if (!loans.length) {
    return Object.fromEntries([...ARIVE_KEYS, ...DERIVED_FROM_COMMISSION].map((k) => [k, 'no Arive import yet']))
  }
  const text = lastImport?.ran_at
    ? `Arive · imported ${new Date(lastImport.ran_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'Arive · import date unknown'
  return Object.fromEntries(ARIVE_KEYS.map((k) => [k, text]))
}

// Returns null (renders as "—", pace "none") rather than NaN/Infinity when the
// denominator is missing: an unknown average must not read as $0.
export function safeDiv(numerator, denominator) {
  const n = Number(numerator || 0)
  const d = Number(denominator || 0)
  if (!d) return null
  return n / d
}

// The Revenue tab. manual: metrics_daily rollup for the visible book(s).
// arive: ariveValues() for the same view (all null on MPG, so combined and
// annualized income are residual only there).
export function revenueValues(manual, arive) {
  const commission = arive.rev_gross_commission
  const combined = Number(commission || 0) + Number(manual.rev_monthly_residual || 0)
  return {
    ...manual,
    rev_closings: arive.rev_closings,
    rev_loan_volume: arive.rev_loan_volume,
    rev_gross_commission: commission,
    rev_combined_income: combined,
    rev_avg_per_closing: safeDiv(commission, arive.rev_closings),
    rev_avg_residual: safeDiv(manual.rev_monthly_residual, manual.rev_active_merchants),
    rev_annualized: combined * 12,
  }
}

// Targets are set per business. A metric shared by both books (calls, live
// conversations, ...) has a Bayway number and an MPG number; the All view
// shows their sum. A one-book metric lives only under its own business.
// Saved shape in settings.metric_targets:
//   { by_business: { bay: {...}, mpg: {...} }, <combined flat keys>, <other keys> }
// The combined flat keys are rewritten on every save so SQL views and older
// readers that look at the top level keep working. Keys that are not METRICS
// (e.g. applications_weekly for the Growth view) pass through untouched.
// Nov 2026 defaults: sized to a realistic month, not the original stretch doc.
export const DEFAULT_TARGETS_BY_BIZ = {
  bay: {
    // Daily
    calls: 30, live_conversations: 8, followups: 15, new_contacts: 3,
    referral_asks: 2, social_minutes: 15,
    // Weekly
    realtor_convos: 15, past_client_touches: 25, new_referral_partners: 1,
    mortgage_consults: 3, weekly_conversations: 40, calls_weekly: 150,
    // Monthly
    realtor_meetings: 4, calls_monthly: 600, pre_approvals: 4, applications: 8,
    loans_closed: 2, loan_volume: 700_000, pipeline_value: 1_500_000,
    db_total: 2000, db_realtors: 200, db_past_clients: 500, db_prospects: 500,
    // Revenue
    rev_closings: 2, rev_loan_volume: 700_000, rev_gross_commission: 7_000,
    rev_combined_income: 7_000, rev_avg_per_closing: 3_500, rev_annualized: 84_000,
    // 90-day sprint (unchanged)
    bay_outbound_attempts: 1200, bay_live_conversations: 240,
    bay_completed_applications: 48, bay_qualified_preapprovals: 30,
    bay_contracts_refis: 16, bay_funded_loans: 10,
    bay_referral_touches: 240,
    bay_pipeline_under_contract: 1, bay_pipeline_preapproved: 3,
    bay_pipeline_waiting_docs: 8,
  },
  mpg: {
    // Daily
    calls: 40, live_conversations: 8, followups: 10, new_contacts: 10,
    referral_asks: 1, social_minutes: 15,
    // Weekly
    bizowner_convos: 40, new_referral_partners: 1, merchant_proposals: 2,
    weekly_conversations: 40, calls_weekly: 200,
    // Monthly
    calls_monthly: 800, businesses_contacted: 800, owner_conversations: 160,
    merchant_proposals_delivered: 8, new_merchant_accounts: 3, new_residual: 300,
    db_total: 1500, db_business_owners: 1500, db_prospects: 1000,
    // Revenue
    rev_active_merchants: 10, rev_monthly_residual: 750, rev_combined_income: 750,
    rev_processing_volume: 300_000, rev_avg_residual: 75, rev_annualized: 9_000,
    // 90-day sprint (unchanged)
    mpg_targeted_contacts: 720, mpg_owner_conversations: 180,
    mpg_discovery_meetings: 48, mpg_statements_received: 36,
    mpg_statements_analyzed: 36, mpg_proposals_sent: 24,
    mpg_merchants_signed: 10, mpg_merchants_activated: 8,
    mpg_qualified_future_pipeline: 15,
  },
}

export const BUSINESSES = ['bay', 'mpg']
const METRIC_BIZ = Object.fromEntries(METRICS.map((m) => [m.key, m.biz]))

// Does this business carry a target for the metric?
export function appliesTo(metricKey, business) {
  const b = METRIC_BIZ[metricKey]
  return b === 'both' || b === business
}

// byBiz: { bay, mpg } target tables. biz: 'all' | 'bay' | 'mpg'.
// A shared metric is that business's number, or the sum on 'all'.
export function targetsForBiz(byBiz, biz = 'all') {
  const out = {}
  for (const m of METRICS) {
    if (m.biz !== 'both') {
      const v = byBiz[m.biz]?.[m.key]
      if (v != null) out[m.key] = v
      continue
    }
    if (biz === 'bay' || biz === 'mpg') {
      const v = byBiz[biz]?.[m.key]
      if (v != null) out[m.key] = v
      continue
    }
    const parts = BUSINESSES.map((b) => byBiz[b]?.[m.key]).filter((v) => v != null)
    if (parts.length) out[m.key] = parts.reduce((a, v) => a + Number(v), 0)
  }
  return out
}

// Combined (All view) defaults.
export const DEFAULT_TARGETS = targetsForBiz(DEFAULT_TARGETS_BY_BIZ, 'all')

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

// Saved per-business overrides over the defaults. A saved value with no
// by_business (the old single combined set) gets the defaults: those numbers
// were combined stretch goals and can't be split back by business.
export function resolveTargetsByBiz(savedValue) {
  const saved = asObject(asObject(savedValue).by_business)
  return Object.fromEntries(BUSINESSES.map((b) => [b, { ...DEFAULT_TARGETS_BY_BIZ[b], ...asObject(saved[b]) }]))
}

// Non-metric keys saved at the top level (Growth view inputs and the like).
function extraKeys(savedValue) {
  return Object.fromEntries(
    Object.entries(asObject(savedValue)).filter(([k]) => k !== 'by_business' && !(k in METRIC_BIZ)),
  )
}

// The target set a view uses: savedValue is settings.metric_targets.value.
export function targetsFor(savedValue, biz = 'all') {
  return { ...DEFAULT_TARGETS, ...extraKeys(savedValue), ...targetsForBiz(resolveTargetsByBiz(savedValue), biz) }
}

// The settings value to store after an edit. edits: { bay: {key: value}, mpg: {...} };
// blank entries are skipped, values coerced to numbers, keys a business
// doesn't carry are dropped.
export function mergeTargetEdits(savedValue, edits) {
  const byBiz = resolveTargetsByBiz(savedValue)
  for (const b of BUSINESSES) {
    for (const [k, v] of Object.entries(asObject(edits?.[b]))) {
      if (v === '' || v == null || !Number.isFinite(Number(v)) || !appliesTo(k, b)) continue
      byBiz[b][k] = Number(v)
    }
  }
  return { ...extraKeys(savedValue), ...targetsForBiz(byBiz, 'all'), by_business: byBiz }
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
// note: an optional subline (where the number came from).
export function metricCardView(metric, value, target, note = null) {
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
    note,
  }
}

// metrics: METRICS subset. values: { [key]: number|null }. targets: { [key]: number }.
// notes: { [key]: string }.
export function buildTabModel(metrics, values, targets = {}, notes = {}) {
  return metrics.map((m) => metricCardView(m, values[m.key] ?? null, targets[m.key], notes[m.key] ?? null))
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
  // Count days on date keys: a fall-back hour would push an exact week to 2.
  return Math.max(0, Math.ceil(keyDaysBetween(start, win.to) / 7))
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
