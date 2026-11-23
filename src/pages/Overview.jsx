// The Overview dashboard (redesign, spec 2026-11-22): the month and the
// whole book. Workbench owns today's order of work; Overview shows its counts.
//   Top     Header with the summary line, sync and Open Workbench
//           Your day (work lists, meetings) · This week's focus + month goals
//           The forecast for both books
//   Book    Loans in flight · Merchants in flight
//           Book health · Rate watch · Source pull-through
//           Trends: touchpoints, the 90-day sprint, income this month
// Numbers come from overviewDash.js, forecast.js, workLists.js,
// bookFlags.js and overviewInsights.js.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { useBusiness } from '../context/BusinessContext'
import { demoBayPipeline, demoMpgLeads } from '../lib/demoData'
import WeeklyFocusCard from '../components/WeeklyFocusCard'
import PageHeader, { SyncDot } from '../components/PageHeader'
import { YourDay, MonthGoals, ForecastBoth, kMoney } from '../components/OverviewTop'
import { LoansInFlight, MerchantsInFlight, BookHealth, RateWatch, PullThrough, Trends } from '../components/OverviewBook'
import { loansInFlight, merchantsInFlight, bookHealth } from '../lib/bookFlags'
import { rateWatch, pullThrough } from '../lib/overviewInsights'
import { sourceTable } from '../lib/analytics'
import { fetchRoiInputs } from '../lib/roiData'
import { aliasMap, roiTable, windowKeys, keyStartMs } from '../lib/roi'
import { centralToday } from '../lib/opportunities'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useForecast } from '../lib/useForecastInputs'
import { forecastLayers, forecastByMonth, monthKeyOf } from '../lib/forecast'
import { useDialList } from '../lib/useDialList'
import { useWorkLane } from '../lib/useWorkLane'
import { useLeadRatings } from '../lib/useLeadRatings'
import { withRatings } from '../lib/leadRatings'
import { buildDialList } from '../lib/dialList'
import { buildThemeList } from '../lib/dialThemes'
import { buildWorkGroups } from '../lib/workbench'
import { workLists, freshLead } from '../lib/workLists'
import { useWorkbenchDay } from '../lib/useWorkbenchDay'
import { applyDayOrder } from '../lib/dayOrder'
import { deriveAlert } from '../lib/overview'
import { targetsFor, monthWindow, sprintWindow, MPG_SPRINT } from '../lib/reports'
import { fetchLoanBundle } from '../lib/loansData'
import { loanStats } from '../lib/loans'
import { todayKey } from '../lib/overviewCards'
import {
  CHART_DAYS,
  prevMonthWindow,
  monthValues,
  activitySeries,
  goalRows,
  mpgSubmittedThisMonth,
  mpgApprovedThisMonth,
  incomeMix,
  sprintPace,
  fundedLoanDeals,
} from '../lib/overviewDash'
import { friendlyError } from '../lib/friendlyError'

const HEALTH_COLUMNS = ', stage_since, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at'
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function dateLine(d = new Date()) {
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
}

const toLead = (c) => ({
  id: c.id,
  business_id: c.business_id,
  person_stage: c.person_stage,
  tags: c.tags,
  source: c.business_id === 'bay' ? c.bay_source : c.mpg_source,
  created: c.business_id === 'bay' ? c.bay_created : c.mpg_created,
})

// ---- Chrome ------------------------------------------------------------------

function ErrorNote({ error }) {
  if (!error) return null
  return <div className="mt-4 rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-xs text-neg-ink">{error}</div>
}

function AlertBanner({ alert }) {
  if (!alert) return null
  const red = alert.level === 'red'
  return (
    <div
      className="mt-4 rounded-lg border px-4 py-3 text-body font-semibold"
      style={
        red
          ? { borderColor: 'var(--neg-line)', background: 'var(--neg-bg)', color: 'var(--neg-ink)' }
          : { borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }
      }
    >
      {alert.text}
    </div>
  )
}

// ---- Data -------------------------------------------------------------------------

function useOverviewData(biz) {
  const [data, setData] = useState(() => (isDemoMode ? demoData() : null))
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const wantsBay = biz !== 'mpg'
        const wantsMpg = biz !== 'bay'
        const prev = prevMonthWindow()
        // Metrics: last month (compares), this month, and the sprint window.
        const metricsFrom = [prev.from, monthWindow().from, MPG_SPRINT.from].sort()[0]
        // Activities: the chart's 30 days and the 30 before, and last month to date.
        const back = new Date()
        back.setHours(0, 0, 0, 0)
        back.setDate(back.getDate() - 2 * CHART_DAYS + 1)
        const actFrom = new Date(Math.min(back.getTime(), new Date(`${prev.from}T00:00:00`).getTime())).toISOString()

        const q = {
          metrics: fetchAllSettled(() =>
            supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', metricsFrom).order('id'),
          ),
          settings: supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
          sync: supabase
            .from('sync_log')
            .select('ran_at, status, message')
            .eq('source', 'fub')
            .order('ran_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          tasks: fetchAllSettled(() => {
            const t = supabase.from('v_tasks').select('id, business_id, due_at, contact_id').order('id')
            return biz === 'all' ? t : t.eq('business_id', biz)
          }),
          // Outbound calls, texts and emails: two months across both books passes 1,000.
          activities: fetchAllSettled(() =>
            supabase
              .from('activities')
              .select('occurred_at, type, business_id')
              .eq('direction', 'outbound')
              .in('type', ['call', 'text', 'email'])
              .gte('occurred_at', actFrom)
              .order('id'),
          ),
          contacts: fetchAllSettled(() =>
            supabase
              .from('contacts')
              .select('id, business_id, person_stage, bay_source:raw->>source, mpg_source:raw->>Lead_Source, bay_created:raw->>created, mpg_created:raw->>Created_Time, tags:raw->tags')
              .order('id'),
          ),
        }
        if (wantsBay) {
          q.bayPipe = fetchAllSettled(() =>
            supabase.from('v_active_pipeline').select(`id, business_id, name, stage, last_touch_at${HEALTH_COLUMNS}, docs_outstanding_count, docs_oldest_requested_at`).eq('business_id', 'bay').order('id'),
          )
          q.deals = fetchAllSettled(() =>
            supabase.from('deals').select('status, value, expected_close, business_id').eq('business_id', 'bay').order('id'),
          )
          q.loans = fetchLoanBundle()
          q.partners = fetchAllSettled(() => supabase.from('v_partners').select('id, name, email, last_touch_at, next_touch_due').order('id'))
          q.rates = loadRateWatch()
        }
        q.roi = fetchRoiInputs()
        if (wantsMpg) {
          q.mpgRows = fetchAllSettled(() => supabase.from('v_mpg_contacts').select(`id, name, company, stage, last_touch_at${HEALTH_COLUMNS}`).order('id'))
          q.walkIns = fetchAllSettled(() =>
            supabase.from('mpg_touches').select('id, occurred_at').eq('channel', 'walk_in').gte('occurred_at', new Date(`${monthWindow().from}T00:00:00`).toISOString()).order('id'),
          )
        }

        const keys = Object.keys(q)
        const settled = await Promise.all(keys.map((k) => q[k]))
        if (!alive) return
        const res = Object.fromEntries(keys.map((k, i) => [k, settled[i]]))
        // Loans are not fatal: without them the cards keep their FUB and
        // entered sources, as before the first Arive import.
        // Partners and walk-ins only feed counts; a failure leaves them out.
        const OPTIONAL = new Set(['loans', 'partners', 'walkIns', 'rates', 'roi'])
        for (const k of OPTIONAL) if (res[k]?.error) console.warn(`Overview: ${k} failed to load`, res[k].error)
        const err = keys.filter((k) => !OPTIONAL.has(k)).map((k) => res[k].error).find(Boolean)
        if (err) {
          setError(err.message)
          return
        }
        setData({
          metrics: res.metrics.data || [],
          targets: targetsFor(res.settings.data?.value, biz),
          latestSync: res.sync.data,
          tasks: res.tasks.data || [],
          activities: res.activities.data || [],
          leads: (res.contacts.data || []).map(toLead),
          bayPipe: res.bayPipe?.data || [],
          deals: res.deals?.data || [],
          loanBundle: res.loans?.data || null,
          mpgRows: (res.mpgRows?.data || []).map((r) => ({ ...r, business_id: 'mpg' })),
          partners: res.partners?.error ? [] : res.partners?.data || [],
          walkIns: !res.walkIns || res.walkIns.error ? null : (res.walkIns.data || []).length,
          rateWatch: res.rates?.error ? null : res.rates?.data || null,
          roi: res.roi?.error ? { aliases: [], spend: [] } : res.roi?.data || { aliases: [], spend: [] },
        })
      } catch (e) {
        if (alive) setError(friendlyError(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [biz])

  return { data, loading, error }
}

// Today's pending Opportunities picks with their estimates and the newest
// PMMS rate -> { data: { picks, estimates, pmms }, error }.
async function loadRateWatch() {
  try {
    const [picks, pmms] = await Promise.all([
      supabase.from('opportunity_picks').select('id, contact_id, status, pick_date, contacts(name)').eq('pick_date', centralToday()).eq('status', 'pending').order('rank').limit(50),
      supabase.from('pmms_weekly').select('week_date, rate_30_fixed').order('week_date', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (picks.error) return { data: null, error: picks.error }
    if (pmms.error) return { data: null, error: pmms.error }
    const ids = (picks.data || []).map((p) => p.contact_id)
    let estimates = new Map()
    if (ids.length) {
      const est = await supabase.from('opportunity_estimates').select('contact_id, est_rate, est_balance').in('contact_id', ids).limit(ids.length)
      if (est.error) return { data: null, error: est.error }
      estimates = new Map((est.data || []).map((e) => [e.contact_id, e]))
    }
    return { data: { picks: picks.data || [], estimates, pmms: pmms.data || null }, error: null }
  } catch (e) {
    return { data: null, error: e }
  }
}

// Source pull-through, last 90 days, from the Analytics ROI table.
function pullThroughBooks(biz, data, now) {
  const keys = windowKeys(90, now)
  const fromMs = keyStartMs(keys.fromKey)
  const contactsById = new Map(data.leads.map((l) => [l.id, l]))
  const aliases = aliasMap(data.roi.aliases)
  const lb = data.loanBundle
  const books = [biz !== 'mpg' && 'bay', biz !== 'bay' && 'mpg'].filter(Boolean)
  return books.map((book) => {
    const table = roiTable(sourceTable(data.leads, book, fromMs), { book, contactsById, loans: lb?.loans || [], rates: lb?.rates, spendRows: data.roi.spend, aliases, ...keys })
    return { book, rows: pullThrough(table, book) }
  })
}

// Latest active-merchant count entered in Reports, or null.
function activeMerchants(metrics) {
  const rows = metrics.filter((m) => m.business_id === 'mpg' && m.metric_key === 'rev_active_merchants' && m.value != null)
  if (!rows.length) return null
  return rows.reduce((a, b) => (String(b.date) > String(a.date) ? b : a)).value
}

function buildView(biz, data, rules, now = Date.now()) {
  const inBook = (b) => biz === 'all' || b === biz
  const activities = data.activities.filter((a) => inBook(a.business_id))
  const lb = data.loanBundle
  const stats = lb ? loanStats(lb.loans, lb.rates, { month: monthWindow(now), prev: prevMonthWindow(now), sprint: sprintWindow() }) : null
  const values = monthValues({ biz, metrics: data.metrics, deals: data.deals, activities: data.activities, pipeline: data.bayPipe, now, loanStats: stats })
  const approvedIds = mpgApprovedThisMonth(data.mpgRows, now)
  return {
    alert: deriveAlert({ latestSync: data.latestSync, tasks: data.tasks, now }),
    values,
    approvedIds: new Set(approvedIds),
    proposals: mpgSubmittedThisMonth(data.mpgRows, now),
    // Once loans are imported, chart closings are funded loans, like the goals.
    series: activitySeries({ activities, pipeline: biz === 'mpg' ? [] : data.bayPipe, deals: biz === 'mpg' ? [] : stats ? fundedLoanDeals(lb.loans) : data.deals, now }),
    income: incomeMix({ values, targets: data.targets }),
    pull: pullThroughBooks(biz, data, now),
    rates: data.rateWatch ? rateWatch(data.rateWatch) : rateWatch({}),
    sprint: sprintPace({ biz, metrics: data.metrics, targets: data.targets, now, measured: stats ? { bay_funded_loans: stats.sprintFunded } : {} }),
    loans: lb ? loansInFlight({ loans: lb.loans, pipeline: data.bayPipe, partners: data.partners || [], now }) : null,
    merchants: merchantsInFlight({ mpgRows: data.mpgRows, tasks: data.tasks, rules, approvedThisMonth: approvedIds.length, now }),
    mpgTiles: [
      { key: 'active', label: 'Active accounts', value: activeMerchants(data.metrics) ?? '—' },
      { key: 'residual', label: 'Residual / month', value: values.residual ? `$${Math.round(values.residual).toLocaleString('en-US')}` : '—' },
      { key: 'walkins', label: 'Walk-ins this month', value: data.walkIns ?? '—' },
    ],
    health: bookHealth({ biz, pipeline: data.bayPipe, mpgRows: data.mpgRows, tasks: data.tasks, partners: data.partners || [], rules, now }),
  }
}

// Today's work lists, from the same builders and data Workbench uses.
function useTodayLists(biz, rules, queue) {
  const day = useWorkbenchDay()
  const dial = useDialList()
  const work = useWorkLane()
  const ratings = useLeadRatings()
  const inBook = (book) => biz === 'all' || book === biz
  const dialRows = useMemo(() => withRatings(dial.rows, ratings), [dial.rows, ratings])
  const dialDue = buildDialList(dialRows, { now: dial.now, skips: dial.skips, inBook })
  const theme = buildThemeList(dial.rows, { now: dial.now, skips: dial.skips, inBook })
  const groups = buildWorkGroups({ pipeline: work.pipeline, mpgTasks: work.tasks, workItems: work.workItems, rules, now: dial.now })
    .filter((g) => g.book == null || inBook(g.book))
    .map((g) => ({ ...g, items: g.items.filter((it) => inBook(it.book)) }))
  const built = workLists({ dial: dialDue, groups, theme, queue: (queue || []).filter((r) => !dial.skips.has(r.id)), now: dial.now })
  // Workbench's saved order for today (read only), so the tiles count what Workbench shows.
  const { lists } = applyDayOrder(built, day.saved)
  return { lists, lead: freshLead(dialDue, dial.now), now: dial.now }
}

export default function Overview() {
  const { biz } = useBusiness()
  const { data, loading, error } = useOverviewData(biz)
  const pq = usePriorityQueue(biz)
  const forecast = useForecast()
  const today = useTodayLists(biz, pq.rules, pq.queue)
  const now = Date.now()
  const view = useMemo(() => (data ? buildView(biz, data, pq.rules) : null), [biz, data, pq.rules])
  const layers = useMemo(() => {
    if (!view) return null
    const opts = { activated: view.values.merchants, approved: view.approvedIds.size, approvedIds: view.approvedIds }
    return {
      this: forecastLayers(forecast.lines, monthKeyOf(now), opts),
      next: forecastLayers(forecast.lines, monthKeyOf(now, 1)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, forecast.lines])
  const goals = useMemo(
    () =>
      view && layers
        ? goalRows({ biz, values: view.values, targets: data.targets, extra: { proposals: view.proposals, closing: layers.this.closingNames.length, approved: view.approvedIds.size } })
        : null,
    [biz, view, layers, data],
  )
  const workCount = today.lists.reduce((n, l) => n + l.count, 0)

  const summary = layers
    ? [
        biz !== 'mpg' && `Bayway is tracking ${layers.this.low === layers.this.high ? kMoney(layers.this.low) : `${kMoney(layers.this.low)}–${kMoney(layers.this.high)}`}${data.targets.rev_gross_commission ? ` of ${kMoney(data.targets.rev_gross_commission)}` : ''}`,
        biz !== 'bay' && `MPG expects ${layers.this.mpg.low === layers.this.mpg.high ? layers.this.mpg.low : `${layers.this.mpg.low}–${layers.this.mpg.high}`}${data.targets.new_merchant_accounts ? ` of ${data.targets.new_merchant_accounts}` : ''} new accounts`,
        `${workCount} ${workCount === 1 ? 'item' : 'items'} in Workbench`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div>
      <PageHeader
        eyebrow={dateLine()}
        title={`${greeting()}, Chandler`}
        subtitle={summary}
        actions={
          <span className="flex items-center gap-3">
            <SyncDot />
            <Link to="/workbench" className="inline-flex min-h-[40px] items-center rounded-lg bg-[color:var(--chrome)] px-4 text-body font-semibold text-white hover:opacity-90">
              Open Workbench →
            </Link>
          </span>
        }
      />
      <ErrorNote error={error} />
      {loading && <div className="mt-6 text-sm text-muted">Loading overview…</div>}

      {!loading && !error && view && (
        <>
          <AlertBanner alert={view.alert} />

          <div className="mt-5 grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <YourDay lists={today.lists} lead={today.lead} now={today.now} />
            <div className="flex min-w-0 flex-col gap-[18px]">
              <WeeklyFocusCard className="" />
              {goals && <MonthGoals model={goals} now={now} />}
            </div>
          </div>

          <div className="mt-[18px]">
            <ForecastBoth
              layers={layers}
              goals={{ bay: data.targets.rev_gross_commission, mpg: data.targets.new_merchant_accounts }}
              biz={biz}
              loading={forecast.loading}
              error={forecast.error}
              undated={forecastByMonth(forecast.lines, monthKeyOf(now)).undated.count}
              now={now}
            />
          </div>

          <div className={`mt-[18px] grid grid-cols-1 items-stretch gap-[18px] ${biz === 'all' ? 'xl:grid-cols-2' : ''}`}>
            {biz !== 'mpg' && view.loans && <LoansInFlight model={view.loans} now={now} />}
            {biz !== 'bay' && <MerchantsInFlight model={view.merchants} tiles={view.mpgTiles} />}
          </div>

          <div className={`mt-[18px] grid grid-cols-1 items-stretch gap-[18px] lg:grid-cols-2 ${biz === 'mpg' ? '' : 'xl:grid-cols-3'}`}>
            <BookHealth rows={view.health} biz={biz} />
            {biz !== 'mpg' && <RateWatch model={view.rates} />}
            <PullThrough books={view.pull} />
          </div>

          <div className="mt-[18px]">
            <Trends series={view.series} sprint={view.sprint} income={view.income} biz={biz} />
          </div>
        </>
      )}
    </div>
  )
}

// ---- Demo ---------------------------------------------------------------------------

function demoData() {
  const today = todayKey()
  const month = today.slice(0, 8) + '01'
  const ago = (d, h = 11) => {
    const t = new Date()
    t.setDate(t.getDate() - d)
    t.setHours(h, 0, 0, 0)
    return t.toISOString()
  }
  const activities = []
  for (let d = 0; d < 2 * CHART_DAYS; d++) {
    const n = 4 + ((d * 7) % 9)
    for (let i = 0; i < n; i++) activities.push({ occurred_at: ago(d, 9 + (i % 8)), type: i % 3 === 0 ? 'text' : 'call', business_id: i % 2 ? 'mpg' : 'bay' })
  }
  return {
    metrics: [
      { date: month, business_id: 'bay', metric_key: 'rev_gross_commission', value: 9800 },
      { date: month, business_id: 'mpg', metric_key: 'rev_monthly_residual', value: 640 },
      { date: month, business_id: 'mpg', metric_key: 'new_merchant_accounts', value: 1 },
      { date: today, business_id: 'bay', metric_key: 'calls', value: 24 },
      { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_funded_loans', value: 3 },
      { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_completed_applications', value: 30 },
      { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_proposals_sent', value: 14 },
      { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_merchants_activated', value: 2 },
    ],
    targets: targetsFor(null, 'all'),
    latestSync: { ran_at: new Date().toISOString(), status: 'ok', message: null },
    tasks: [],
    activities,
    leads: [
      { business_id: 'bay', source: 'LendingFlow', created: ago(3), person_stage: 'Lead', tags: ['Application/Estimate Sent'] },
      { business_id: 'bay', source: 'LendingFlow', created: ago(5), person_stage: 'Lead', tags: [] },
      { business_id: 'mpg', source: 'Website', created: ago(2), person_stage: 'Open', tags: null },
    ],
    bayPipe: demoBayPipeline(),
    deals: [
      { status: 'won', value: 340000, expected_close: today, business_id: 'bay' },
      { status: 'open', value: 625000, expected_close: null, business_id: 'bay' },
    ],
    mpgRows: demoMpgLeads(),
    roi: { aliases: [], spend: [] },
  }
}
