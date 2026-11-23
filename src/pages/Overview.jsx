// The Overview dashboard (redesign, spec 2026-11-22): the month and the
// whole book. Workbench owns today's order of work; Overview shows its counts.
//   Top     Header with the summary line, sync and Open Workbench
//           Your day (work lists, meetings) · This week's focus + month goals
//           The forecast for both books
//   Below   Activity, pipeline mix, lead sources and sprints, until the
//           later build steps replace them (A5–A10)
// Numbers come from overviewDash.js, forecast.js and workLists.js.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { useBusiness } from '../context/BusinessContext'
import { demoBayPipeline, demoMpgLeads } from '../lib/demoData'
import BizBadge from '../components/BizBadge'
import WeeklyFocusCard from '../components/WeeklyFocusCard'
import PageHeader, { SyncDot } from '../components/PageHeader'
import { YourDay, MonthGoals, ForecastBoth, kMoney } from '../components/OverviewTop'
import { LoansInFlight, MerchantsInFlight, BookHealth } from '../components/OverviewBook'
import { loansInFlight, merchantsInFlight, bookHealth } from '../lib/bookFlags'
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
import { deriveAlert } from '../lib/overview'
import { MPG_LEAD_FLOW } from '../lib/pipeline'
import { pipelineKpis } from '../lib/pipelineView'
import { targetsFor, monthWindow, sprintWindow, MPG_SPRINT } from '../lib/reports'
import { fetchLoanBundle } from '../lib/loansData'
import { loanStats } from '../lib/loans'
import { todayKey } from '../lib/overviewCards'
import { BAY_STAGES } from '../../supabase/functions/_shared/bay-stages.ts'
import {
  CHART_DAYS,
  ACT_CHART,
  prevMonthWindow,
  monthValues,
  activitySeries,
  activityChart,
  goalRows,
  mpgSubmittedThisMonth,
  mpgApprovedThisMonth,
  pipelineMix,
  topSources,
  sprintPace,
  fundedLoanDeals,
} from '../lib/overviewDash'
import { friendlyError } from '../lib/friendlyError'

const BAY_MIX_STAGES = BAY_STAGES.slice(0, 5)
const BAY_MIX_COLORS = ['#C5DDA6', '#A4C97A', '#7CAD44', '#4F7A22', '#1F2A5C']
// Shorter names for the legend, which sits beside the donut.
const SHORT_STAGE = { 'Application/Estimate Sent': 'App/Estimate Sent', 'Application Received': 'App Received', 'Initial Lead Follow Up': 'Follow Up', 'Closed Non-Compatible': 'Closed' }
// MPG's working stages, Not Contacted to Approved (Closed and Nurture are off the mix).
const MPG_MIX_STAGES = MPG_LEAD_FLOW.slice(0, 5)
const MPG_MIX_COLORS = ['#CDEBF8', '#7CCBEB', '#26ABE0', '#0F7AA8', '#1F2A5C']
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
  business_id: c.business_id,
  person_stage: c.person_stage,
  tags: c.tags,
  source: c.business_id === 'bay' ? c.bay_source : c.mpg_source,
  created: c.business_id === 'bay' ? c.bay_created : c.mpg_created,
})

// ---- Chrome ------------------------------------------------------------------

function Card({ title, sub, link, className = '', label, children }) {
  return (
    <section aria-label={label || title} className={`cc-card flex min-w-0 flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-lead font-semibold tracking-[-0.2px]">{title}</h3>
          {sub && <div className="mt-0.5 text-body text-muted">{sub}</div>}
        </div>
        {link && (
          <Link to={link.to} className="-my-2 -mr-2 inline-flex min-h-[36px] flex-none items-center rounded-lg px-2 text-body font-semibold text-[color:var(--chrome)] hover:bg-hoverbg">
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function Bar({ pct, color, h = 6 }) {
  return (
    <div className="overflow-hidden rounded-full bg-hoverbg" style={{ height: h }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  )
}

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

// ---- Row 2: Activity & Production, Monthly goals -------------------------------------

const DAY_FMT = { weekday: 'short', month: 'short', day: 'numeric' }

function ActivityCard({ series, showProduction }) {
  const chart = useMemo(() => activityChart(series.points), [series])
  const [hover, setHover] = useState(series.points.length - 1)
  const p = series.points[hover] || series.points.at(-1)
  const pt = chart.points[hover] || chart.points.at(-1)
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * ACT_CHART.width
    const n = series.points.length
    const i = Math.round(((x - ACT_CHART.x0) / (ACT_CHART.x1 - ACT_CHART.x0)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const delta = (now, before) => {
    if (!before) return { text: now ? 'new' : '—', ink: 'var(--dim)' }
    const pct = Math.round(((now - before) / before) * 100)
    return { text: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}%`, ink: pct >= 0 ? 'var(--pos-ink)' : 'var(--neg-ink)' }
  }
  const stats = [
    { label: 'Touchpoints', now: series.totals.touch, before: series.prev.touch },
    { label: 'Calls', now: series.totals.calls, before: series.prev.calls },
    showProduction && { label: 'Apps & estimates', now: series.totals.apps, before: series.prev.apps },
    showProduction && { label: 'Closings', now: series.totals.closings, before: series.prev.closings },
  ].filter(Boolean)
  // The tip sits right of the hovered day, or left of it past the middle.
  const at = pt ? (pt.x / ACT_CHART.width) * 100 : 0
  const tipPos = at > 55 ? { right: `${100 - at + 3}%` } : { left: `${at + 3}%` }

  return (
    <Card
      title="Activity & Production"
      label="Activity and production"
      className="xl:col-span-2"
      sub={
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--chrome)' }} />Activity · calls, texts, emails</span>
          {showProduction && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--bay)' }} />Production · apps, estimates, closings</span>}
        </span>
      }
    >
      <div className="relative px-5 pb-1 pt-4">
        <svg viewBox={`0 0 ${ACT_CHART.width} ${ACT_CHART.height}`} className="block h-auto w-full" role="img" aria-label={`Daily activity${showProduction ? ' and production' : ''}, last ${CHART_DAYS} days`} onMouseMove={onMove} onMouseLeave={() => setHover(series.points.length - 1)}>
          <defs>
            <linearGradient id="actFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1F2A5C" stopOpacity=".14" />
              <stop offset="1" stopColor="#1F2A5C" stopOpacity="0" />
            </linearGradient>
          </defs>
          {chart.ticks.map((t) => (
            <g key={t.y}>
              <line x1={ACT_CHART.x0} x2={ACT_CHART.x1} y1={t.y} y2={t.y} stroke={t.label === 0 ? '#EAECF0' : '#F2F4F7'} />
              <text x="0" y={t.y + 4} fontSize="11" fill="#667085">{t.label}</text>
            </g>
          ))}
          {pt && <rect x={pt.x - 12} y={ACT_CHART.top - 6} width="24" height={ACT_CHART.bottom - ACT_CHART.top + 6} rx="4" fill="#1F2A5C" fillOpacity=".07" />}
          <path d={chart.fill} fill="url(#actFill)" />
          <path d={chart.act} fill="none" stroke="#1F2A5C" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          {showProduction && <path d={chart.prod} fill="none" stroke="#7CAD44" strokeWidth="2.2" strokeDasharray="6 5" strokeLinejoin="round" strokeLinecap="round" />}
          {pt && <circle cx={pt.x} cy={pt.ay} r="4.5" fill="#FFFFFF" stroke="#1F2A5C" strokeWidth="2" />}
          {pt && showProduction && <circle cx={pt.x} cy={pt.py} r="4.5" fill="#FFFFFF" stroke="#7CAD44" strokeWidth="2" />}
          {chart.labels.map((l) => (
            <text key={l.i} x={l.x} y={ACT_CHART.height - 4} fontSize="11.5" fill="#667085" textAnchor={l.i === series.points.length - 1 ? 'end' : l.i === 0 ? 'start' : 'middle'}>
              {l.label}
            </text>
          ))}
        </svg>
        {p && (
          <div data-chart-tip className="pointer-events-none absolute top-6 w-[210px] rounded-lg border border-line bg-panel px-3 py-2.5 text-body shadow-[0_8px_20px_rgba(16,24,40,.1)]" style={tipPos}>
            <div className="font-semibold">{new Date(`${p.key}T12:00:00`).toLocaleDateString(undefined, DAY_FMT)}</div>
            <div className="mt-1.5 flex justify-between text-muted">Touchpoints<span className="num font-semibold text-[color:var(--chrome)]">{p.touch}</span></div>
            <div className="mt-0.5 flex justify-between text-muted">Calls<span className="num font-semibold text-[color:var(--text)]">{p.calls}</span></div>
            {showProduction && (
              <div className="mt-0.5 flex justify-between text-muted">Apps &amp; closings<span className="num font-semibold text-[color:var(--bay-ink)]">{p.prod}</span></div>
            )}
          </div>
        )}
      </div>
      <div className="mt-auto grid border-t border-line" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map((s) => {
          const d = delta(s.now, s.before)
          return (
            <div key={s.label} className="border-r border-hoverbg px-5 py-3 last:border-r-0">
              <div className="text-body text-dim">{s.label}</div>
              <div className="mt-0.5 text-lead font-semibold">
                <span className="num">{s.now.toLocaleString()}</span>{' '}
                <span className="text-body font-semibold" style={{ color: d.ink }} title={`vs the ${CHART_DAYS} days before`}>{d.text}</span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---- Row 3: Pipeline mix, Lead sources ---------------------------------------------

function Donut({ slices, size = 150, center, sub, label }) {
  return (
    <svg width={size} height={size} viewBox="0 0 150 150" role="img" aria-label={label} className="flex-none">
      <circle cx="75" cy="75" r="56" fill="none" stroke="#F2F4F7" strokeWidth="22" />
      {slices.map((s) => (
        <circle
          key={s.key}
          cx="75"
          cy="75"
          r="56"
          fill="none"
          stroke={s.color}
          strokeWidth="22"
          pathLength="100"
          strokeDasharray={`${Math.max(0, s.pct - (slices.length > 1 ? 0.6 : 0))} ${100 - Math.max(0, s.pct - (slices.length > 1 ? 0.6 : 0))}`}
          strokeDashoffset={s.offset}
          transform="rotate(-90 75 75)"
        />
      ))}
      <text x="75" y={sub ? 74 : 81} textAnchor="middle" fontSize={String(center).length > 6 ? 18 : 24} fontWeight="600" fill="#101828">{center}</text>
      {sub && <text x="75" y="93" textAnchor="middle" fontSize="11.5" fill="#475467">{sub}</text>}
    </svg>
  )
}

function PipelineMixCard({ biz, rows, rules }) {
  const mpg = biz === 'mpg'
  const stages = mpg ? MPG_MIX_STAGES : BAY_MIX_STAGES
  const colors = mpg ? MPG_MIX_COLORS : BAY_MIX_COLORS
  const mix = pipelineMix(rows, stages)
  const kpis = pipelineKpis(rows.filter((r) => stages.includes(r.stage)), rules, mpg ? 'mpg' : 'bay')
  const stuck = kpis[3]
  const slices = mix.slices.map((s) => ({ key: s.stage, pct: s.pct, offset: s.offset, color: colors[stages.indexOf(s.stage)] }))
  return (
    <Card
      title="Pipeline Mix"
      sub={mpg ? 'MPG leads by stage' : 'Bayway active leads by stage'}
      link={{ to: mpg ? '/mpg/pipeline' : '/bayway/pipeline', label: 'Pipeline' }}
    >
      <div className="flex items-center gap-5 px-5 py-[18px]">
        <Donut slices={slices} size={128} center={mix.total} sub="active" label="Pipeline by stage" />
        <div className="flex min-w-0 flex-1 flex-col gap-[9px]">
          {mix.slices.map((s) => (
            <div key={s.stage} data-mix={s.stage} className="flex items-center gap-2 text-body">
              <span className="h-[9px] w-[9px] flex-none rounded-sm" style={{ background: colors[stages.indexOf(s.stage)] }} />
              <span className="flex-1 truncate" title={s.stage}>{SHORT_STAGE[s.stage] || s.stage}</span>
              <span className="num font-semibold">{s.n}</span>
            </div>
          ))}
          {mix.total === 0 && <div className="text-body text-muted">No active leads.</div>}
        </div>
      </div>
      <div className="mx-5 mb-4 mt-auto rounded-lg bg-panel2 px-3 py-2.5 text-body text-muted">
        <b className="text-[color:var(--text)]">{stuck.value}</b> stuck in stage · {stuck.foot}
      </div>
    </Card>
  )
}

function SourcesCard({ biz, sources }) {
  const max = Math.max(1, ...sources.map((s) => s.leads))
  const rateWord = biz === 'mpg' ? 'approved' : biz === 'bay' ? 'reached app' : 'reached app / approved'
  return (
    <Card title="Lead Sources" sub={`New leads this month · % ${rateWord}`} link={{ to: '/analytics', label: 'Analytics' }}>
      <div className="flex flex-col gap-[13px] px-5 pb-[18px] pt-3.5">
        {sources.map((s) => (
          <div key={`${s.book}-${s.source}`} data-source={s.source}>
            <div className="flex items-center gap-2 text-body">
              {biz === 'all' && <BizBadge biz={s.book} />}
              <span className="flex-1 truncate font-medium">{s.source}</span>
              <span className="num font-semibold">{s.leads}</span>
              <span className="num w-11 text-right text-body text-dim">{s.rate}%</span>
            </div>
            <div className="mt-[5px]">
              <Bar pct={(s.leads / max) * 100} color={s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)'} h={8} />
            </div>
          </div>
        ))}
        {sources.length === 0 && <div className="py-6 text-center text-body text-muted">No new leads this month yet.</div>}
      </div>
    </Card>
  )
}

// ---- Sprints ---------------------------------------------------------------------

function SprintCard({ model }) {
  const sub = model.ended
    ? `${model.label} · ended · final results`
    : `${model.label} · ${model.weeksLeft} ${model.weeksLeft === 1 ? 'week' : 'weeks'} left`
  // A finished sprint is judged on the result (Hit / Missed), not live pace.
  const good = (s) => (model.ended ? s.hit : s.onPace)
  const word = (s) => (model.ended ? (s.hit ? 'Hit' : 'Missed') : s.onPace ? 'On pace' : 'Behind')
  return (
    <Card title={model.ended ? 'Last 90-Day Sprint' : '90-Day Sprints'} sub={sub} link={{ to: '/reports', label: 'Reports' }}>
      <div className="flex flex-col gap-[13px] px-5 pb-[18px] pt-3.5">
        {model.items.map((s) => (
          <div key={s.key} data-sprint={s.key}>
            <div className="flex items-center gap-2 text-body">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }} />
              <span className="flex-1 truncate font-medium">{s.label}</span>
              <span className="num text-muted">{s.value} / {s.target}</span>
              <span
                className="flex-none rounded-md border px-[7px] py-px text-micro font-semibold"
                style={good(s) ? { borderColor: 'var(--pos-line)', background: 'var(--pos-bg)', color: 'var(--pos-ink)' } : { borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}
              >
                {word(s)}
              </span>
            </div>
            <div className="ml-4 mt-[5px]">
              <Bar pct={s.pct} color={s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)'} />
            </div>
          </div>
        ))}
        {model.ended && <div className="text-body text-muted">The next sprint isn’t set yet.</div>}
      </div>
    </Card>
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
              .select('business_id, person_stage, bay_source:raw->>source, mpg_source:raw->>Lead_Source, bay_created:raw->>created, mpg_created:raw->>Created_Time, tags:raw->tags')
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
        }
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
        const OPTIONAL = new Set(['loans', 'partners', 'walkIns'])
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
    sources: topSources(data.leads, biz, new Date(`${monthWindow(now).from}T00:00:00`).getTime()),
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
function useTodayLists(biz, rules) {
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
  return { lists: workLists({ dial: dialDue, groups, theme, now: dial.now }), lead: freshLead(dialDue, dial.now), now: dial.now }
}

export default function Overview() {
  const { biz } = useBusiness()
  const { data, loading, error } = useOverviewData(biz)
  const pq = usePriorityQueue(biz)
  const forecast = useForecast()
  const today = useTodayLists(biz, pq.rules)
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

          <div className="mt-[18px] grid grid-cols-1 items-stretch gap-[18px] lg:grid-cols-2 xl:grid-cols-3">
            <BookHealth rows={view.health} biz={biz} />
            <PipelineMixCard biz={biz} rows={biz === 'mpg' ? data.mpgRows : data.bayPipe} rules={pq.rules} />
            <SourcesCard biz={biz} sources={view.sources} />
          </div>

          <div className="mt-[18px] grid grid-cols-1 items-stretch gap-[18px] xl:grid-cols-3">
            <ActivityCard series={view.series} showProduction={biz !== 'mpg'} />
            <SprintCard model={view.sprint} />
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
  }
}
