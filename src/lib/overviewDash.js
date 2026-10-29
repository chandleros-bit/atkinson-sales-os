// The Overview dashboard's numbers: the four month-to-date KPI cards, the
// 30-day Activity & Production chart, monthly goal pace (the gauge), the
// pipeline mix, lead sources, income mix and sprint pace. Pure, no React, no
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
import { niceMax, smoothPath } from './overviewCards'
import { sourceTable } from './analytics'
import { isLostStage } from './pipeline'

export const CHART_DAYS = 30
export const PRODUCTION_STAGES = new Set(['Application/Estimate Sent', 'Application Received', 'Disclosed'])
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
const changePct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null)
const signed = (n) => (n > 0 ? `↑ ${n}` : n < 0 ? `↓ ${Math.abs(n)}` : '→ 0')

// The month's raw values every card reads, for the visible book(s).
// activities: outbound call/text/email rows { occurred_at, type, business_id }.
export function monthValues({ biz, metrics, deals = [], activities = [], pipeline = [], now = Date.now() }) {
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
  return {
    commission: bay ? sumMetric(month, 'bay', 'rev_gross_commission') : 0,
    residual: mpg ? sumMetric(month, 'mpg', 'rev_monthly_residual') : 0,
    loansClosed: bay ? countWon(deals, win) : 0,
    loansClosedPrev: bay ? countWon(deals, prev) : 0,
    merchants: mpg ? sumMetric(month, 'mpg', 'new_merchant_accounts') : 0,
    merchantsPrev: mpg ? sumMetric(prevMonth, 'mpg', 'new_merchant_accounts') : 0,
    proposals: mpg ? sumMetric(month, 'mpg', 'merchant_proposals_delivered') : 0,
    calls: manualCalls(month) + callsBetween(acts, win.from, win.to),
    callsPrevSoFar: manualCalls(prevMonth, cut) + callsBetween(acts, prev.from, cut),
    callsToday: manualCalls(month.filter((r) => String(r.date).slice(0, 10) === today)) + callsBetween(acts, today, tomorrow),
    applications: bay ? countIn(prod, win.from, win.to) : 0,
    pipelineValue: bay ? pipelineValue(deals) : 0,
    openLoans: bay ? deals.filter((d) => d.status === 'open').length : 0,
    prevMonthLabel: MONTHS[Number(prev.from.slice(5, 7)) - 1],
  }
}

// The four KPI cards. Money cards are entered in Reports ("Entered"); the
// rest are live. mpg-only swaps commission for residual and pipeline value
// for open leads.
export function kpiCards({ biz, values: v, targets, mpgRows = [] }) {
  const bay = biz !== 'mpg'
  const mpg = biz !== 'bay'
  const money = bay
    ? { id: 'commission', label: 'Gross commission (MTD)', value: v.commission, unit: 'currency', goal: targets.rev_gross_commission, tag: 'Entered', icon: 'money', tone: 'bay' }
    : { id: 'residual', label: 'MPG residual (MTD)', value: v.residual, unit: 'currency', goal: targets.rev_monthly_residual, tag: 'Entered', icon: 'money', tone: 'mpg' }
  money.pct = pctOf(money.value, money.goal)
  money.delta = { text: `${money.pct}% of goal`, tone: 'flat' }
  money.foot = `Goal ${fmtMoney(money.goal)}${bay && biz === 'bay' ? '' : bay ? ' · Bayway' : ''}`

  const closed = v.loansClosed + v.merchants
  const closedPrev = v.loansClosedPrev + v.merchantsPrev
  const closedGoal = (bay ? targets.loans_closed : 0) + (mpg ? targets.new_merchant_accounts : 0)
  const diff = closed - closedPrev
  const closedCard = {
    id: 'closed',
    label: 'Closed this month',
    value: closed,
    unit: 'count',
    goal: closedGoal,
    pct: pctOf(closed, closedGoal),
    tag: biz === 'mpg' ? 'Entered' : biz === 'bay' ? 'Live' : null,
    icon: 'key',
    tone: 'chrome',
    delta: { text: `${signed(diff)} vs ${v.prevMonthLabel}`, tone: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' },
    foot: biz === 'all' ? `Bayway ${v.loansClosed} loans · MPG ${v.merchants} merchants` : biz === 'bay' ? `Goal ${closedGoal} loans` : `Goal ${closedGoal} merchant accounts`,
  }

  const callChange = changePct(v.calls, v.callsPrevSoFar)
  const calls = {
    id: 'calls',
    label: 'Calls this month',
    value: v.calls,
    unit: 'count',
    goal: targets.calls_monthly,
    pct: pctOf(v.calls, targets.calls_monthly),
    tag: 'Live',
    icon: 'phone',
    tone: 'mpg',
    delta: callChange == null ? { text: `${v.calls ? '↑' : '→'} new`, tone: 'flat' } : { text: `${callChange >= 0 ? '↑' : '↓'} ${Math.abs(callChange)}% vs ${v.prevMonthLabel}`, tone: callChange >= 0 ? 'up' : 'down' },
    foot: `${v.callsToday} today`,
  }

  let fourth
  if (bay) {
    fourth = {
      id: 'pipeline',
      label: 'Pipeline value (open)',
      value: v.pipelineValue,
      unit: 'currency',
      goal: targets.pipeline_value,
      pct: pctOf(v.pipelineValue, targets.pipeline_value),
      tag: 'Live',
      icon: 'pipeline',
      tone: 'neutral',
      delta: { text: `${pctOf(v.pipelineValue, targets.pipeline_value)}% of goal`, tone: 'flat' },
      foot: `${v.openLoans} open ${v.openLoans === 1 ? 'loan' : 'loans'}${biz === 'all' ? ' · Bayway' : ''}`,
    }
  } else {
    const open = mpgRows.filter((r) => !isLostStage(r.stage))
    const qualified = open.filter((r) => r.stage === 'Pre-Qualified' || r.stage === 'Qualified').length
    fourth = {
      id: 'open_leads',
      label: 'Open MPG leads',
      value: open.length,
      unit: 'count',
      goal: 0,
      pct: open.length ? Math.round((qualified / open.length) * 100) : 0,
      tag: 'Live',
      icon: 'pipeline',
      tone: 'neutral',
      delta: { text: `${qualified} qualified`, tone: 'flat' },
      foot: 'Zoho leads not lost',
    }
  }
  return [money, closedCard, calls, fourth]
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

export const ACT_CHART = { x0: 40, x1: 760, top: 14, bottom: 214, width: 760, height: 236 }

// smoothPath, with control points held inside the plot: spiky days (0, 17, 0)
// would otherwise curve below the zero line.
function clampedSmooth(pts, c) {
  return smoothPath(pts).replace(/C ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g, (_, x1, y1, x2, y2) => {
    const clamp = (y) => Math.min(c.bottom, Math.max(c.top, Number(y))).toFixed(1)
    return `C ${x1} ${clamp(y1)} ${x2} ${clamp(y2)}`
  })
}

// SVG geometry for the chart: both lines share one y scale (production is a
// handful a day, touchpoints dozens, so production sits low, as in the mock).
export function activityChart(points, c = ACT_CHART) {
  const max = niceMax(points.flatMap((p) => [p.touch, p.prod]))
  const n = points.length
  const x = (i) => (n <= 1 ? c.x0 : c.x0 + (i * (c.x1 - c.x0)) / (n - 1))
  const y = (v) => c.bottom - (v / max) * (c.bottom - c.top)
  const act = points.map((p, i) => [x(i), y(p.touch)])
  const prod = points.map((p, i) => [x(i), y(p.prod)])
  const actPath = clampedSmooth(act, c)
  const fill = n ? `${actPath} L ${x(n - 1).toFixed(1)} ${c.bottom} L ${c.x0} ${c.bottom} Z` : ''
  const ticks = [0, 1, 2, 3, 4].map((i) => ({ y: c.bottom - (i / 4) * (c.bottom - c.top), label: Math.round((max * i) / 4) }))
  const every = Math.max(1, Math.round((n - 1) / 4))
  const labels = points
    .map((p, i) => ({ i, x: x(i), label: i === n - 1 ? 'Today' : `${MONTHS[Number(p.key.slice(5, 7)) - 1]} ${Number(p.key.slice(8, 10))}` }))
    .filter((l) => l.i === n - 1 || (l.i % every === 0 && n - 1 - l.i >= every / 2))
  return { max, act: actPath, prod: clampedSmooth(prod, c), fill, ticks, labels, x, y, points: act.map((a, i) => ({ x: a[0], ay: a[1], py: prod[i][1] })) }
}

// ---- Monthly goals (the gauge) ---------------------------------------------------

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

// Half-circle segments as pathLength-100 dashes: [{ status, dash, offset }].
export function gaugeSegments(counts, gap = 1.5) {
  const order = ['hit', 'pace', 'behind']
  const total = order.reduce((s, k) => s + counts[k], 0)
  if (!total) return []
  const live = order.filter((k) => counts[k] > 0)
  const room = 100 - gap * (live.length - 1)
  let at = 0
  return live.map((k) => {
    const len = (counts[k] / total) * room
    const seg = { status: k, dash: `${len.toFixed(2)} ${(100 - len).toFixed(2)}`, offset: (-at).toFixed(2) }
    at += len + gap
    return seg
  })
}

// ---- Pipeline mix, sources, income, sprints ---------------------------------------

// rows with .stage, counted in `stages` order; stages with nobody are dropped.
export function pipelineMix(rows, stages) {
  const counts = Object.fromEntries(stages.map((s) => [s, 0]))
  for (const r of rows) if (r.stage in counts) counts[r.stage] += 1
  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  let at = 0
  const slices = stages
    .filter((s) => counts[s] > 0)
    .map((s) => {
      const pct = (counts[s] / total) * 100
      const slice = { stage: s, n: counts[s], pct, offset: -at }
      at += pct
      return slice
    })
  return { total, slices }
}

// The biggest lead sources this month across the visible books, with the
// share that reached an application (Bayway) or qualified (MPG).
export function topSources(leads, biz, fromMs, n = 5) {
  const books = biz === 'all' ? ['bay', 'mpg'] : [biz]
  return books
    .flatMap((b) => sourceTable(leads, b, fromMs).rows.map((r) => ({ book: b, source: r.source, leads: r.leads, rate: r.rate })))
    .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source))
    .slice(0, n)
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
  }
}

const SPRINT_ITEMS = [
  { key: 'mpg_merchants_activated', label: 'MPG merchants activated', book: 'mpg' },
  { key: 'mpg_proposals_sent', label: 'MPG proposals sent', book: 'mpg' },
  { key: 'bay_funded_loans', label: 'Bayway funded loans', book: 'bay' },
  { key: 'bay_completed_applications', label: 'Bayway applications', book: 'bay' },
]

export function sprintPace({ biz, metrics, targets, now = Date.now() }) {
  const win = sprintWindow()
  const rows = sprintRows(metrics)
  const elapsed = sprintElapsed(win, now)
  const items = SPRINT_ITEMS.filter((s) => biz === 'all' || s.book === biz).map((s) => {
    const value = sumMetric(rows, s.book, s.key)
    const target = targets[s.key]
    return { ...s, value, target, pct: pctOf(value, target), onPace: goalStatus(value, target, elapsed) !== 'behind' }
  })
  return { items, weeksLeft: weeksRemaining(win, now), label: win.label }
}
