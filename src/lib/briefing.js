// Chandler's daily briefing (spec 2026-11-03, section 3): the email's content,
// built with the same pure logic the app uses so the two always agree. Pure,
// no I/O; the daily-briefing edge function loads `data` and renders the result.
import { buildQueue, resolveRules, reasonText } from './priorityQueue'
import { buildDialList } from './dialList'
import { buildAlerts } from './alerts'
import { monthValues, monthlyGoals, prevMonthWindow, PRODUCTION_STAGES } from './overviewDash'
import { DEFAULT_TARGETS, resolveTargets, monthWindow, sprintWindow } from './reports'
import { loanStats, resolveRates, isOpen, isScenario } from './loans'
import { resolveForecast, forecastLines, forecastByMonth, avgFundedLoan, mpgPerAccount, latestMpgMetrics, monthKeyOf } from './forecast'
import { syncHealth } from './syncHealth'
import { yesterdayScorecard, needPerDay } from './briefingScorecard'
import { withRatings } from './leadRatings'
import { businessDaysLeft, longDateLabel, chicagoDateKey, previousBusinessDateKey } from './briefingTime'

const TOP = 5
// Goals shown in the briefing (Overview goals minus commission and residual).
const GOAL_IDS = ['calls', 'applications', 'closings', 'merchants', 'proposals']
const WORK_STAGES = new Set(['Contacted/Working', 'Application Received', 'Disclosed'])

const list = (rows, toItem) => ({ count: rows.length, top: rows.slice(0, TOP).map(toItem) })

function ratingsMap(rows) {
  return new Map((rows || []).map((r) => [r.contact_id, { ...r, name: r.contact?.name ?? null }]))
}

// data fields beyond the plan's contract:
//   yesterdayActivities  the previous business day's (Chicago) activities; Monday looks at Friday
//   pipeline             all Bayway board rows (new applications are picked by PRODUCTION_STAGES)
//   mpgMetricRows        optional, newest-first rev_monthly_residual / rev_active_merchants rows
//                        for latestMpgMetrics; falls back to `metrics` sorted newest first
export function buildOwnerBriefing(data, now = Date.now()) {
  const rules = resolveRules(data.rules)
  const targets = resolveTargets(DEFAULT_TARGETS, data.targets)
  const rates = resolveRates(data.rates)
  const fs = resolveForecast(data.forecastSettings)

  // ---- Numbers ------------------------------------------------------------
  const stats = data.loans?.length
    ? loanStats(data.loans, rates, { month: monthWindow(now), prev: prevMonthWindow(now), sprint: sprintWindow() })
    : null
  const values = monthValues({ biz: 'all', metrics: data.metrics || [], deals: data.deals || [], activities: data.activities || [], pipeline: data.pipeline || [], now, loanStats: stats })
  const daysLeft = businessDaysLeft(now)
  // 'all' leaves out proposals (MPG only), so take that one from the MPG view.
  const proposals = monthlyGoals({ biz: 'mpg', values, targets, now }).goals.find((g) => g.id === 'proposals')
  const goals = monthlyGoals({ biz: 'all', values, targets, now }).goals
    .filter((g) => GOAL_IDS.includes(g.id))
    .concat(proposals ? [proposals] : [])
    .map((g) => ({ id: g.id, label: g.label, value: g.value, target: g.target, status: g.status, unit: g.unit, needPerDay: g.status === 'behind' ? needPerDay(g, daysLeft) : null }))

  const mpgRows = data.mpgMetricRows || (data.metrics || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const rated = ratingsMap(data.ratings)
  const lines = forecastLines({
    ratings: rated,
    loans: data.loans || [],
    rates,
    settings: fs,
    avgLoan: avgFundedLoan(data.loans || [], now),
    mpgAccount: mpgPerAccount(latestMpgMetrics(mpgRows), fs),
    now,
  })
  const f = forecastByMonth(lines, monthKeyOf(now))

  const prevDay = previousBusinessDateKey(now)
  const newApplications = (data.pipeline || []).filter(
    (r) => PRODUCTION_STAGES.has(r.stage) && r.stage_since && chicagoDateKey(new Date(r.stage_since).getTime()) === prevDay,
  )
  const [py, pm, pd] = prevDay.split('-').map(Number)
  const label = prevDay === chicagoDateKey(now, -1) ? 'Yesterday' : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(Date.UTC(py, pm - 1, pd)))
  const scorecard = { ...yesterdayScorecard({ activities: data.yesterdayActivities || [], newApplications }), label }

  // ---- Today --------------------------------------------------------------
  const meetings = (data.events || [])
    .slice()
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .map((e) => ({ time: e.is_all_day ? 'All day' : e.starts_at, title: e.title || '(no title)', book: String(e.source_account || '').includes('mpg') ? 'mpg' : 'bay' }))
  const today = chicagoDateKey(now)
  const weekOut = chicagoDateKey(now, 6)
  const closingRows = (data.loans || [])
    .filter((l) => !isScenario(l) && isOpen(l) && l.firm_closing_on && l.firm_closing_on >= today && l.firm_closing_on <= weekOut)
    .sort((a, b) => a.firm_closing_on.localeCompare(b.firm_closing_on))

  // ---- Call first ---------------------------------------------------------
  const queue = buildQueue(withRatings(data.signals || [], rated), rules, now)
  const inBucket = (id) => queue.filter((r) => r.bucket === id)
  const person = (r) => ({ name: r.name || '(no name)', detail: reasonText(r, now) })
  const dial = buildDialList(withRatings(data.dialRows || [], rated), { now, skips: new Set(data.dialSkips || []) })
  const due = dial.dueNow.concat(dial.laterToday)
  const callFirst = {
    replied: list(inBucket('reached_out'), person),
    newLeads: list(inBucket('new_lead'), person),
    cadence: { bay: due.filter((i) => i.book === 'bay').length, mpg: due.filter((i) => i.book === 'mpg').length },
    overdue: list(inBucket('overdue'), person),
    hotCold: list(inBucket('hot_cold'), person),
  }

  // ---- Slipping -----------------------------------------------------------
  const alerts = buildAlerts({
    queue,
    signals: data.signals || [],
    pipeline: (data.pipeline || []).filter((r) => WORK_STAGES.has(r.stage)),
    tasks: data.mpgTasks || [],
    workItems: data.workItems || [],
    rules,
    now,
  })
  const alertList = (id) => {
    const a = alerts.find((x) => x.id === id)
    if (!a) return { count: 0, top: [] }
    const people = a.people.concat(a.rest || [])
    return { count: a.count, top: people.slice(0, TOP).map((p) => ({ name: p.name, detail: p.detail })) }
  }
  const health = syncHealth(data.syncLatest || {}, now)
  const syncProblems = health.detail.filter((d) => d.state !== 'ok').map((d) => ({ label: d.label, text: d.text }))
  const slipping = {
    quietApps: alertList('quiet_apps'),
    docsAging: alertList('docs_aging'),
    statementsLate: alertList('statements_late'),
    syncProblems,
  }

  return {
    dateLabel: longDateLabel(now),
    numbers: {
      goals,
      forecast: { expected: f.bay.expected, funded: f.bay.funded, weighted: f.bay.weighted, mpgAccounts: f.mpg.accounts, mpgExpected: f.mpg.expected },
      scorecard,
    },
    today: { meetings, closings: list(closingRows, (l) => ({ name: l.borrower_name || '(no name)', date: l.firm_closing_on })) },
    callFirst,
    slipping,
    callFirstCount: callFirst.replied.count + callFirst.newLeads.count + callFirst.overdue.count + callFirst.hotCold.count,
    nothingSlipping: !slipping.quietApps.count && !slipping.docsAging.count && !slipping.statementsLate.count && !syncProblems.length,
  }
}
