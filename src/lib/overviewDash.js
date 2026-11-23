// The Overview dashboard's numbers: the month's values, the 30-day activity
// series, month goals (goalRows; monthlyGoals feeds the briefing), MPG stage
// counts, income mix and sprint pace. Pure, no React, no
// I/O; Overview.jsx fetches and draws.
//
// Sources, as on Reports: commission, residual and merchant accounts are typed
// into Reports (metrics_daily); closings and pipeline value come from deals;
// calls are manual entries plus synced outbound calls. "Production" counts
// leads whose current stage is App/Estimate Sent or Application Received by
// the day they entered it (contacts.stage_since, tracked since 2026-10-18),
// plus won deals by close date.
import { dayKey } from './calendar'
import { rollupMetrics, monthWindow, countWon, pipelineValue, inWindow, sprintRows, sprintWindow, weeksRemaining } from './reports'
import { isScenario } from './loans'

export const CHART_DAYS = 30
export const PRODUCTION_STAGES = new Set(['Application/Estimate Sent', 'Application Received', 'Pre-Approved', 'Disclosed'])
const TOUCH_TYPES = new Set(['call', 'text', 'email'])
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const keyMs = (k) => new Date(`${k}T00:00:00`).getTime()

// Last month's { from, to }, and the same day-of-month cut for "so far" compares.
export function prevMonthWindow(now = Date.now()) {
  const d = new Date(now)
  return monthWindow(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime())
}
function prevSameDayKey(now) {
  const d = new Date(now)
  const last = new Date(d.getFullYear(), d.getMonth(), 0).getDate()
  return keyOf(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), last) + 1))
}

// Share of this month gone, counting today: Oct 27 of 31 days -> 27/31.
export function monthElapsed(now = Date.now()) {
  const d = new Date(now)
  return d.getDate() / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

// Share of the sprint gone, counting today.
export function sprintElapsed(win = sprintWindow(), now = Date.now()) {
  const span = keyMs(win.to) - keyMs(win.from)
  if (span <= 0) return 1
  const today = keyMs(keyOf(new Date(now))) + 86_400_000
  return Math.min(1, Math.max(0, (today - keyMs(win.from)) / span))
}

const inBookFor = (biz) => (b) => biz === 'all' || b === biz
const sumMetric = (rows, book, key) => Number(rollupMetrics(rows.filter((r) => r.business_id === book))[key] || 0)
const monthRowsOf = (metrics, win) => metrics.filter((r) => inWindow(r.date, win.from, win.to))

// Leads that entered a production stage, by local day key.
function productionDays(pipeline) {
  const out = {}
  for (const r of pipeline) {
    if (!PRODUCTION_STAGES.has(r.stage) || !r.stage_since) continue
    const k = dayKey(r.stage_since)
    out[k] = (out[k] || 0) + 1
  }
  return out
}
const countIn = (byDay, from, to) => Object.entries(byDay).reduce((n, [k, v]) => (k >= from && k < to ? n + v : n), 0)

// Synced outbound calls on or after fromKey and before toKey.
const callsBetween = (activities, from, to) =>
  activities.filter((a) => a.type === 'call' && a.occurred_at && dayKey(a.occurred_at) >= from && dayKey(a.occurred_at) < to).length

export function pctOf(value, goal) {
  if (!goal) return 0
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / goal) * 100)))
}

// The month's raw values every card reads, for the visible book(s).
// activities: outbound call/text/email rows { occurred_at, type, business_id }.
export function monthValues({ biz, metrics, deals = [], activities = [], pipeline = [], now = Date.now(), loanStats = null }) {
  const inBook = inBookFor(biz)
  const win = monthWindow(now)
  const prev = prevMonthWindow(now)
  const cut = prevSameDayKey(now)
  const today = keyOf(new Date(now))
  const tomorrow = keyOf(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1))
  const month = monthRowsOf(metrics, win)
  const prevMonth = monthRowsOf(metrics, prev)
  const acts = activities.filter((a) => inBook(a.business_id))
  const bay = inBook('bay')
  const mpg = inBook('mpg')
  const manualCalls = (rows, to = '9999') =>
    rows.filter((r) => inBook(r.business_id) && r.metric_key === 'calls' && String(r.date).slice(0, 10) < to).reduce((s, r) => s + Number(r.value || 0), 0)
  const prod = productionDays(pipeline)
  // Once any loan is imported, Bayway's loan numbers come from Arive.
  const arive = bay && loanStats ? loanStats : null
  return {
    commission: arive ? arive.commission : bay ? sumMetric(month, 'bay', 'rev_gross_commission') : 0,
    commissionFromArive: !!arive,
    residual: mpg ? sumMetric(month, 'mpg', 'rev_monthly_residual') : 0,
    loansClosed: arive ? arive.closed : bay ? countWon(deals, win) : 0,
    loansClosedPrev: arive ? arive.closedPrev : bay ? countWon(deals, prev) : 0,
    merchants: mpg ? sumMetric(month, 'mpg', 'new_merchant_accounts') : 0,
    merchantsPrev: mpg ? sumMetric(prevMonth, 'mpg', 'new_merchant_accounts') : 0,
    proposals: mpg ? sumMetric(month, 'mpg', 'merchant_proposals_delivered') : 0,
    calls: manualCalls(month) + callsBetween(acts, win.from, win.to),
    callsPrevSoFar: manualCalls(prevMonth, cut) + callsBetween(acts, prev.from, cut),
    callsToday: manualCalls(month.filter((r) => String(r.date).slice(0, 10) === today)) + callsBetween(acts, today, tomorrow),
    applications: bay ? countIn(prod, win.from, win.to) : 0,
    pipelineValue: arive ? arive.pipeline : bay ? pipelineValue(deals) : 0,
    openLoans: arive ? arive.open : bay ? deals.filter((d) => d.status === 'open').length : 0,
    prevMonthLabel: MONTHS[Number(prev.from.slice(5, 7)) - 1],
  }
}

export function fmtMoney(n) {
  const v = Number(n || 0)
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
  if (Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K`
  return `$${Math.round(v).toLocaleString()}`
}

// ---- Activity & Production ------------------------------------------------------

// `days` daily points ending today, plus totals for this window and the one
// before it (activities should reach back 2 × days). Production is Bayway only.
export function activitySeries({ activities = [], pipeline = [], deals = [], days = CHART_DAYS, now = Date.now() }) {
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const keys = []
  for (let i = days - 1; i >= 0; i--) keys.push(keyOf(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)))
  const from = keys[0]
  const to = keyOf(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1))
  const prevFrom = keyOf(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 2 * days + 1))

  const touchBy = {}
  const callBy = {}
  for (const a of activities) {
    if (!a.occurred_at || !TOUCH_TYPES.has(a.type)) continue
    const k = dayKey(a.occurred_at)
    touchBy[k] = (touchBy[k] || 0) + 1
    if (a.type === 'call') callBy[k] = (callBy[k] || 0) + 1
  }
  const apps = productionDays(pipeline)
  const won = {}
  for (const d of deals) {
    if (d.status !== 'won' || !d.expected_close) continue
    const k = String(d.expected_close).slice(0, 10)
    won[k] = (won[k] || 0) + 1
  }
  const points = keys.map((k) => ({
    key: k,
    touch: touchBy[k] || 0,
    calls: callBy[k] || 0,
    apps: apps[k] || 0,
    closings: won[k] || 0,
    prod: (apps[k] || 0) + (won[k] || 0),
  }))
  const totals = (f, t) => ({
    touch: countIn(touchBy, f, t),
    calls: countIn(callBy, f, t),
    apps: countIn(apps, f, t),
    closings: countIn(won, f, t),
  })
  return { points, totals: totals(from, to), prev: totals(prevFrom, from) }
}

// Funded Arive loans in the deal shape activitySeries reads, so the chart's
// closings follow the loans once they are imported. Scenario files never count.
export function fundedLoanDeals(loans) {
  return loans
    .filter((l) => l.funded_on && !isScenario(l))
    .map((l) => ({ status: 'won', value: Number(l.amount || 0), expected_close: l.funded_on, business_id: 'bay' }))
}

// ---- Monthly goals ---------------------------------------------------

// hit: at or past target. pace: on track for the month so far. behind: neither.
export function goalStatus(value, target, elapsed) {
  if (!target) return 'pace'
  if (value >= target) return 'hit'
  return value / target >= elapsed ? 'pace' : 'behind'
}

export function monthlyGoals({ biz, values: v, targets, now = Date.now() }) {
  const elapsed = monthElapsed(now)
  const bay = biz !== 'mpg'
  const mpg = biz !== 'bay'
  const list = [
    { id: 'calls', label: 'Calls', value: v.calls, target: targets.calls_monthly, unit: 'count' },
    bay && { id: 'closings', label: 'Loans closed', value: v.loansClosed, target: targets.loans_closed, unit: 'count' },
    bay && { id: 'commission', label: 'Gross commission', value: v.commission, target: targets.rev_gross_commission, unit: 'currency' },
    bay && { id: 'applications', label: 'Applications', value: v.applications, target: targets.applications, unit: 'count' },
    mpg && { id: 'merchants', label: 'New merchant accounts', value: v.merchants, target: targets.new_merchant_accounts, unit: 'count' },
    mpg && biz === 'mpg' && { id: 'residual', label: 'MPG residual', value: v.residual, target: targets.rev_monthly_residual, unit: 'currency' },
    mpg && biz === 'mpg' && { id: 'proposals', label: 'Proposals delivered', value: v.proposals, target: targets.merchant_proposals_delivered, unit: 'count' },
  ]
    .filter(Boolean)
    .map((g) => ({ ...g, pct: pctOf(g.value, g.target), status: goalStatus(g.value, g.target, elapsed) }))
  const count = (s) => list.filter((g) => g.status === s).length
  const counts = { hit: count('hit'), pace: count('pace'), behind: count('behind') }
  const onPace = list.length ? Math.round(((counts.hit + counts.pace) / list.length) * 100) : 0
  return { goals: list, counts, onPace }
}

// MPG proposals this month (spec 2026-11-22, decision 4): merchants moved to
// Zoho Submitted this month. A merchant that went on to Approved this month
// was submitted this month too, so both stages count when stage_since is in
// the month. mpgRows: v_mpg_contacts rows { stage, stage_since }.
export function mpgSubmittedThisMonth(mpgRows, now = Date.now()) {
  const win = monthWindow(now)
  return (mpgRows || []).filter((r) => (r.stage === 'Submitted' || r.stage === 'Approved') && r.stage_since && inWindow(dayKey(r.stage_since), win.from, win.to)).length
}

// MPG merchants approved this month, by id: they count as accounts coming.
export function mpgApprovedThisMonth(mpgRows, now = Date.now()) {
  const win = monthWindow(now)
  return (mpgRows || []).filter((r) => r.stage === 'Approved' && r.stage_since && inWindow(dayKey(r.stage_since), win.from, win.to)).map((r) => r.id)
}

// November goals (spec 2026-11-22, A3): five rows, the briefing goals, for the
// visible book(s). pace: 'hit' | 'pace' | 'behind'. word: what the row says;
// when a goal is behind but work in hand covers it ("2 closing"), the fact
// replaces "Behind". behind: the most behind row (lowest value / expected so
// far), or null. extra: { proposals, closing, approved }.
export function goalRows({ biz, values: v, targets, extra = {}, now = Date.now() }) {
  const elapsed = monthElapsed(now)
  const d = new Date(now)
  const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate()
  const bay = biz !== 'mpg'
  const mpg = biz !== 'bay'
  const rows = [
    { id: 'calls', label: 'Calls', book: null, value: v.calls, target: targets.calls_monthly },
    bay && { id: 'applications', label: 'Bayway apps', book: 'bay', value: v.applications, target: targets.applications },
    bay && { id: 'funded', label: 'Loans funded', book: 'bay', value: v.loansClosed, target: targets.loans_closed, inHand: extra.closing || 0, inHandWord: 'closing' },
    mpg && { id: 'proposals', label: 'MPG proposals', book: 'mpg', value: extra.proposals || 0, target: targets.merchant_proposals_delivered },
    mpg && { id: 'accounts', label: 'MPG accounts', book: 'mpg', value: v.merchants, target: targets.new_merchant_accounts, inHand: extra.approved || 0, inHandWord: 'approved' },
  ]
    .filter(Boolean)
    .map((g) => {
      const value = Number(g.value || 0)
      const target = Number(g.target || 0)
      const status = goalStatus(value, target, elapsed)
      const covered = status === 'behind' && g.inHand > 0 && value + g.inHand >= target * elapsed
      const word = status === 'hit' ? 'Hit' : status === 'pace' ? 'On pace' : covered ? `${g.inHand} ${g.inHandWord}` : 'Behind'
      const gap = target ? value / (target * Math.max(elapsed, 1e-9)) : 1
      return { ...g, value, target, pct: pctOf(value, target), status, word, gap, covered }
    })
  const behind = rows.filter((g) => g.status === 'behind' && !g.covered).sort((a, b) => a.gap - b.gap)[0] || null
  return { rows, behind, daysLeft }
}

export function incomeMix({ values: v, targets }) {
  const total = v.commission + v.residual
  return {
    commission: v.commission,
    residual: v.residual,
    total,
    goal: targets.rev_combined_income,
    pct: pctOf(total, targets.rev_combined_income),
    annualized: total * 12,
    share: total ? v.commission / total : 0,
    fromArive: !!v.commissionFromArive,
  }
}

const SPRINT_ITEMS = [
  { key: 'mpg_merchants_activated', label: 'MPG merchants activated', book: 'mpg' },
  { key: 'mpg_proposals_sent', label: 'MPG proposals sent', book: 'mpg' },
  { key: 'bay_funded_loans', label: 'Bayway funded loans', book: 'bay' },
  { key: 'bay_completed_applications', label: 'Bayway applications', book: 'bay' },
]

export function sprintPace({ biz, metrics, targets, now = Date.now(), measured = {} }) {
  const win = sprintWindow()
  const rows = sprintRows(metrics)
  const elapsed = sprintElapsed(win, now)
  const items = SPRINT_ITEMS.filter((s) => biz === 'all' || s.book === biz).map((s) => {
    const value = measured[s.key] ?? sumMetric(rows, s.book, s.key)
    const target = targets[s.key]
    return { ...s, value, target, pct: pctOf(value, target), onPace: goalStatus(value, target, elapsed) !== 'behind', hit: value >= target }
  })
  // Past the window the sprint is history: final results, not live pace.
  const ended = keyOf(new Date(now)) >= win.to
  return { items, weeksLeft: weeksRemaining(win, now), label: win.label, ended }
}
