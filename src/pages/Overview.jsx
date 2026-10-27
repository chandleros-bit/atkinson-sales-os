// The Overview dashboard: this month at a glance across MPG and Bayway.
//   Row 1  KPI cards: gross commission (MPG view: residual), closed this
//          month, calls this month, pipeline value (MPG view: open leads)
//   Row 2  Activity & Production (30 days) · Monthly goals gauge
//   Row 3  Today's events · Pipeline mix · Lead sources
//   Row 4  Income mix · Up Next · 90-day sprints
// Numbers come from overviewDash.js; this file fetches and draws.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { useBusiness } from '../context/BusinessContext'
import TodayAgenda from '../components/TodayAgenda'
import BizBadge from '../components/BizBadge'
import PersonLink from '../components/PersonLink'
import Icon from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { urgentCount, reasonText } from '../lib/priorityQueue'
import { deriveAlert } from '../lib/overview'
import { MPG_LEAD_FLOW } from '../lib/pipeline'
import { pipelineKpis } from '../lib/pipelineView'
import { formatPhone, telHref } from '../lib/phone'
import { DEFAULT_TARGETS, resolveTargets, monthWindow, formatValue, MPG_SPRINT } from '../lib/reports'
import { todayKey } from '../lib/overviewCards'
import { BAY_STAGES } from '../../supabase/functions/_shared/bay-stages.ts'
import {
  CHART_DAYS,
  ACT_CHART,
  prevMonthWindow,
  monthValues,
  kpiCards,
  activitySeries,
  activityChart,
  monthlyGoals,
  gaugeSegments,
  pipelineMix,
  topSources,
  incomeMix,
  sprintPace,
  fmtMoney,
} from '../lib/overviewDash'

const BAY_MIX_STAGES = BAY_STAGES.slice(0, 5)
const BAY_MIX_COLORS = ['#C5DDA6', '#A4C97A', '#7CAD44', '#4F7A22', '#1F2A5C']
// Shorter names for the legend, which sits beside the donut.
const SHORT_STAGE = { 'Application/Estimate Sent': 'App/Estimate Sent', 'Application Received': 'App Received', 'Attempted to Contact': 'Attempted', 'Contact in Future': 'Contact later' }
const MPG_MIX_COLORS = ['#CDEBF8', '#A6DCF2', '#7CCBEB', '#4FB8E3', '#26ABE0', '#0F7AA8', '#1F2A5C']
const STATUS_COLOR = { hit: 'var(--chrome)', pace: 'var(--bay)', behind: '#F79009' }
const STATUS_LABEL = { hit: 'Hit', pace: 'On pace', behind: 'Behind' }
const DELTA_INK = { up: 'var(--pos-ink)', down: 'var(--neg-ink)', flat: 'var(--text)' }
const KPI_INK = { bay: 'var(--bay-ink)', mpg: 'var(--mpg-ink)', chrome: 'var(--chrome)', neutral: '#344054' }
const KPI_BAR = { bay: 'var(--bay)', mpg: 'var(--mpg)', chrome: 'var(--chrome)', neutral: 'var(--muted)' }
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
          <h3 className="text-[17px] font-semibold tracking-[-0.2px]">{title}</h3>
          {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
        </div>
        {link && (
          <Link to={link.to} className="flex-none text-[13px] font-semibold text-[color:var(--chrome)] hover:underline">
            {link.label} ↗
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
  return <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
}

function AlertBanner({ alert }) {
  if (!alert) return null
  const red = alert.level === 'red'
  return (
    <div
      className="mt-4 rounded-xl border px-4 py-3 text-[13.5px] font-semibold"
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

// ---- Row 1: KPI cards ------------------------------------------------------------

function KpiCard({ card }) {
  const value = card.unit === 'currency' ? formatValue(card.value, 'currency') : Number(card.value || 0).toLocaleString()
  return (
    <section data-kpi={card.id} className="cc-card flex min-w-0 flex-col overflow-hidden">
      <div className="px-[18px] pb-3.5 pt-4">
        <div className="flex items-center justify-between">
          <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-line" style={{ color: KPI_INK[card.tone] }}>
            <Icon name={card.icon} size={20} />
          </span>
          {card.tag && (
            <span
              className="rounded-md border px-[7px] py-px text-[11px] font-semibold"
              title={card.tag === 'Entered' ? 'Typed into Reports' : 'From synced CRM data'}
              style={card.tag === 'Entered' ? { borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' } : { borderColor: 'var(--line2)', background: 'var(--panel2)', color: 'var(--muted)' }}
            >
              {card.tag}
            </span>
          )}
        </div>
        <div className="mt-3.5 text-[14px] text-muted">{card.label}</div>
        <div className="num mt-1 text-[28px] font-semibold tracking-[-0.6px]">{value}</div>
        <div className="mt-2.5">
          <Bar pct={card.pct} color={KPI_BAR[card.tone]} />
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line bg-panel2 px-[18px] py-2.5 text-[13px]">
        <span className="flex-none font-semibold" style={{ color: DELTA_INK[card.delta.tone] }}>
          {card.delta.text}
        </span>
        <span className="truncate text-muted">{card.foot}</span>
      </div>
    </section>
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
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: 'var(--chrome)' }} />Activity · calls, texts, emails</span>
          {showProduction && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: 'var(--bay)' }} />Production · apps, estimates, closings</span>}
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
          <div data-chart-tip className="pointer-events-none absolute top-6 w-[210px] rounded-[10px] border border-line bg-panel px-3 py-2.5 text-[12.5px] shadow-[0_8px_20px_rgba(16,24,40,.1)]" style={tipPos}>
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
              <div className="text-[12.5px] text-dim">{s.label}</div>
              <div className="mt-0.5 text-[18px] font-semibold">
                <span className="num">{s.now.toLocaleString()}</span>{' '}
                <span className="text-[12.5px] font-semibold" style={{ color: d.ink }} title={`vs the ${CHART_DAYS} days before`}>{d.text}</span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function GoalsCard({ model }) {
  const segs = gaugeSegments(model.counts)
  return (
    <Card title="Monthly Goals" link={{ to: '/reports', label: 'Reports' }}>
      <div className="flex justify-center px-5 pt-4">
        <svg width="260" height="146" viewBox="0 0 260 146" role="img" aria-label={`Monthly goals: ${model.onPace}% on pace`}>
          <path d="M20 130 A110 110 0 0 1 240 130" pathLength="100" fill="none" stroke="#F2F4F7" strokeWidth="26" />
          {segs.map((s) => (
            <path key={s.status} d="M20 130 A110 110 0 0 1 240 130" pathLength="100" fill="none" stroke={STATUS_COLOR[s.status]} strokeWidth="26" strokeDasharray={s.dash} strokeDashoffset={s.offset} />
          ))}
          <text x="130" y="108" textAnchor="middle" fontSize="30" fontWeight="600" fill="#101828">{model.onPace}%</text>
          <text x="130" y="130" textAnchor="middle" fontSize="12.5" fill="#475467">of monthly goals on pace</text>
        </svg>
      </div>
      <div className="flex flex-col gap-[11px] px-5 pb-4 pt-2.5">
        {model.goals.map((g) => (
          <div key={g.id} data-goal={g.id} data-status={g.status}>
            <div className="flex items-center gap-2 text-[13.5px]">
              <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: STATUS_COLOR[g.status] }} title={STATUS_LABEL[g.status]} />
              <span className="flex-1 font-medium">{g.label}</span>
              <span className="num text-muted">
                {g.unit === 'currency' ? `${fmtMoney(g.value)} / ${fmtMoney(g.target)}` : `${g.value.toLocaleString()} / ${g.target.toLocaleString()}`}
              </span>
            </div>
            <div className="ml-[17px] mt-[5px]">
              <Bar pct={g.pct} color={STATUS_COLOR[g.status]} h={5} />
            </div>
          </div>
        ))}
        <div className="mt-0.5 flex gap-3.5 text-[12px] text-dim">
          {['hit', 'pace', 'behind'].map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]} {model.counts[s]}
            </span>
          ))}
        </div>
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
  const stages = mpg ? MPG_LEAD_FLOW : BAY_MIX_STAGES
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
            <div key={s.stage} data-mix={s.stage} className="flex items-center gap-2 text-[13px]">
              <span className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: colors[stages.indexOf(s.stage)] }} />
              <span className="flex-1 truncate" title={s.stage}>{SHORT_STAGE[s.stage] || s.stage}</span>
              <span className="num font-semibold">{s.n}</span>
            </div>
          ))}
          {mix.total === 0 && <div className="text-[13px] text-muted">No active leads.</div>}
        </div>
      </div>
      <div className="mx-5 mb-4 mt-auto rounded-[10px] bg-panel2 px-3 py-2.5 text-[12.5px] text-muted">
        <b className="text-[color:var(--text)]">{stuck.value}</b> stuck in stage · {stuck.foot}
      </div>
    </Card>
  )
}

function SourcesCard({ biz, sources }) {
  const max = Math.max(1, ...sources.map((s) => s.leads))
  const rateWord = biz === 'mpg' ? 'qualified' : biz === 'bay' ? 'reached app' : 'reached app / qualified'
  return (
    <Card title="Lead Sources" sub={`New leads this month · % ${rateWord}`} link={{ to: '/analytics', label: 'Analytics' }}>
      <div className="flex flex-col gap-[13px] px-5 pb-[18px] pt-3.5">
        {sources.map((s) => (
          <div key={`${s.book}-${s.source}`} data-source={s.source}>
            <div className="flex items-center gap-2 text-[13.5px]">
              {biz === 'all' && <BizBadge biz={s.book} />}
              <span className="flex-1 truncate font-medium">{s.source}</span>
              <span className="num font-semibold">{s.leads}</span>
              <span className="num w-11 text-right text-[12.5px] text-dim">{s.rate}%</span>
            </div>
            <div className="mt-[5px]">
              <Bar pct={(s.leads / max) * 100} color={s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)'} h={8} />
            </div>
          </div>
        ))}
        {sources.length === 0 && <div className="py-6 text-center text-[13px] text-muted">No new leads this month yet.</div>}
      </div>
    </Card>
  )
}

// ---- Row 4: Income mix, Up Next, Sprints --------------------------------------------

function IncomeCard({ model, biz }) {
  const slices = []
  if (model.total > 0) {
    if (model.commission > 0) slices.push({ key: 'bay', pct: model.share * 100, offset: 0, color: 'var(--bay)' })
    if (model.residual > 0) slices.push({ key: 'mpg', pct: (1 - model.share) * 100, offset: -model.share * 100, color: 'var(--mpg)' })
  }
  const rows = [
    biz !== 'mpg' && { key: 'bay', label: 'Bayway commission', value: model.commission, color: 'var(--bay)' },
    biz !== 'bay' && { key: 'mpg', label: 'MPG residual', value: model.residual, color: 'var(--mpg)' },
  ].filter(Boolean)
  return (
    <Card title="Income Mix" sub={`This month · ${model.pct}% of ${fmtMoney(model.goal)} goal`} link={{ to: '/reports', label: 'Reports' }}>
      <div className="flex items-center gap-5 px-5 py-[18px]">
        <Donut slices={slices} size={130} center={fmtMoney(model.total)} label="Income by book" />
        <div className="flex flex-1 flex-col gap-3 text-[13.5px]">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center gap-2">
                <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: r.color }} />
                {r.label}
              </div>
              <div className="num ml-[17px] mt-0.5 text-[17px] font-semibold">{formatValue(r.value, 'currency')}</div>
            </div>
          ))}
          <div className="text-[12.5px] text-muted">Annualized {fmtMoney(model.annualized)}</div>
        </div>
      </div>
      <div className="mx-5 mb-4 mt-auto text-[12px] text-dim">Entered in Reports</div>
    </Card>
  )
}

function UpNextCard({ queue, loading, error }) {
  const top = queue.slice(0, 4)
  return (
    <Card
      title="Up Next"
      sub={loading ? 'Loading…' : `${queue.length} to work · ${urgentCount(queue)} need action now`}
      link={{ to: '/workbench', label: 'Workbench' }}
    >
      {error && <div className="px-5 py-6 text-center text-[13px] text-muted">{error}</div>}
      {!loading && !error && top.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-muted">Nobody slipping. Nice work.</div>}
      <div className="pb-2 pt-1">
        {top.map((r) => {
          const tel = telHref(r.phone)
          const urgent = r.bucket === 'reached_out' || r.bucket === 'new_lead'
          return (
            <div key={r.id} data-up-next className="flex items-center gap-2.5 border-b border-hoverbg px-5 py-[9px] last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <BizBadge biz={r.business_id} />
                  <PersonLink id={r.id} url={r.crm_profile_url} className="min-w-0 truncate text-[14px] font-semibold">
                    {r.name || '(no name)'}
                  </PersonLink>
                </div>
                <div className="mt-0.5 truncate text-[12.5px] font-semibold" style={{ color: urgent ? 'var(--neg-ink)' : 'var(--text)' }}>
                  {reasonText(r)}
                </div>
              </div>
              {tel && (
                <a href={tel} aria-label={`Call ${r.name || 'lead'}`} title={`Call ${formatPhone(r.phone)}`} className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] bg-[color:var(--chrome)] text-white hover:opacity-90">
                  <Icon name="phone" size={15} strokeWidth={1.9} />
                </a>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function SprintCard({ model }) {
  return (
    <Card title="90-Day Sprints" sub={`${model.label} · ${model.weeksLeft} ${model.weeksLeft === 1 ? 'week' : 'weeks'} left`} link={{ to: '/reports', label: 'Reports' }}>
      <div className="flex flex-col gap-[13px] px-5 pb-[18px] pt-3.5">
        {model.items.map((s) => (
          <div key={s.key} data-sprint={s.key}>
            <div className="flex items-center gap-2 text-[13.5px]">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }} />
              <span className="flex-1 truncate font-medium">{s.label}</span>
              <span className="num text-muted">{s.value} / {s.target}</span>
              <span
                className="flex-none rounded-md border px-[7px] py-px text-[11px] font-semibold"
                style={s.onPace ? { borderColor: 'var(--pos-line)', background: 'var(--pos-bg)', color: 'var(--pos-ink)' } : { borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}
              >
                {s.onPace ? 'On pace' : 'Behind'}
              </span>
            </div>
            <div className="ml-4 mt-[5px]">
              <Bar pct={s.pct} color={s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)'} />
            </div>
          </div>
        ))}
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
            const t = supabase.from('v_tasks').select('id, business_id, due_at').order('id')
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
            supabase.from('v_active_pipeline').select(`id, business_id, name, stage, last_touch_at${HEALTH_COLUMNS}`).eq('business_id', 'bay').order('id'),
          )
          q.deals = fetchAllSettled(() =>
            supabase.from('deals').select('status, value, expected_close, business_id').eq('business_id', 'bay').order('id'),
          )
        }
        if (wantsMpg) {
          q.mpgRows = fetchAllSettled(() => supabase.from('v_mpg_contacts').select(`id, name, company, stage, last_touch_at${HEALTH_COLUMNS}`).order('id'))
        }

        const keys = Object.keys(q)
        const settled = await Promise.all(keys.map((k) => q[k]))
        if (!alive) return
        const res = Object.fromEntries(keys.map((k, i) => [k, settled[i]]))
        const err = keys.map((k) => res[k].error).find(Boolean)
        if (err) {
          setError(err.message)
          return
        }
        setData({
          metrics: res.metrics.data || [],
          targets: resolveTargets(DEFAULT_TARGETS, res.settings.data?.value),
          latestSync: res.sync.data,
          tasks: res.tasks.data || [],
          activities: res.activities.data || [],
          leads: (res.contacts.data || []).map(toLead),
          bayPipe: res.bayPipe?.data || [],
          deals: res.deals?.data || [],
          mpgRows: (res.mpgRows?.data || []).map((r) => ({ ...r, business_id: 'mpg' })),
        })
      } catch (e) {
        if (alive) setError(String(e?.message || e))
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

function buildView(biz, data) {
  const inBook = (b) => biz === 'all' || b === biz
  const now = Date.now()
  const activities = data.activities.filter((a) => inBook(a.business_id))
  const values = monthValues({ biz, metrics: data.metrics, deals: data.deals, activities: data.activities, pipeline: data.bayPipe, now })
  return {
    alert: deriveAlert({ latestSync: data.latestSync, tasks: data.tasks, now }),
    kpis: kpiCards({ biz, values, targets: data.targets, mpgRows: data.mpgRows }),
    series: activitySeries({ activities, pipeline: biz === 'mpg' ? [] : data.bayPipe, deals: biz === 'mpg' ? [] : data.deals, now }),
    goals: monthlyGoals({ biz, values, targets: data.targets, now }),
    sources: topSources(data.leads, biz, new Date(`${monthWindow(now).from}T00:00:00`).getTime()),
    income: incomeMix({ values, targets: data.targets }),
    sprint: sprintPace({ biz, metrics: data.metrics, targets: data.targets, now }),
  }
}

export default function Overview() {
  const { biz } = useBusiness()
  const { data, loading, error } = useOverviewData(biz)
  const pq = usePriorityQueue(biz)
  const view = useMemo(() => (data ? buildView(biz, data) : null), [biz, data])

  const subtitle =
    biz === 'bay' ? 'Bayway view — mortgage only.'
    : biz === 'mpg' ? 'MPG view — merchant services only.'
    : 'This month across MPG and Bayway.'

  return (
    <div>
      <PageHeader
        eyebrow={dateLine()}
        title={`${greeting()}, Chandler`}
        subtitle={subtitle}
        actions={
          <span className="flex min-h-[36px] items-center gap-2 rounded-[9px] border border-line2 px-3 text-[13px] font-medium text-[#344054]">
            <Icon name="calendar" size={16} />
            {MONTH_NAMES[new Date().getMonth()]}
          </span>
        }
      />
      <ErrorNote error={error} />
      {isDemoMode && (
        <div className="mt-4 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-xs text-muted">
          Demo mode — connect Supabase to see live numbers.
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-muted">Loading overview…</div>}

      {!loading && !error && view && (
        <>
          <AlertBanner alert={view.alert} />

          <div className="mt-5 grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
            {view.kpis.map((c) => (
              <KpiCard key={c.id} card={c} />
            ))}
          </div>

          <div className="mt-[18px] grid grid-cols-1 items-stretch gap-[18px] xl:grid-cols-3">
            <ActivityCard series={view.series} showProduction={biz !== 'mpg'} />
            <GoalsCard model={view.goals} />
          </div>

          <div className="mt-[18px] grid grid-cols-1 items-stretch gap-[18px] lg:grid-cols-2 xl:grid-cols-3">
            <TodayAgenda />
            <PipelineMixCard biz={biz} rows={biz === 'mpg' ? data.mpgRows : data.bayPipe} rules={pq.rules} />
            <SourcesCard biz={biz} sources={view.sources} />
          </div>

          <div className="mt-[18px] grid grid-cols-1 items-stretch gap-[18px] lg:grid-cols-2 xl:grid-cols-3">
            <IncomeCard model={view.income} biz={biz} />
            <UpNextCard queue={pq.queue} loading={pq.loading} error={pq.error} />
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
    targets: resolveTargets(DEFAULT_TARGETS, null),
    latestSync: { ran_at: new Date().toISOString(), status: 'ok', message: null },
    tasks: [],
    activities,
    leads: [
      { business_id: 'bay', source: 'LendingFlow', created: ago(3), person_stage: 'Lead', tags: ['Application/Estimate Sent'] },
      { business_id: 'bay', source: 'LendingFlow', created: ago(5), person_stage: 'Lead', tags: [] },
      { business_id: 'mpg', source: 'Website', created: ago(2), person_stage: 'Contacted', tags: null },
    ],
    bayPipe: [
      { id: 'b1', business_id: 'bay', name: 'Ramirez Purchase', stage: 'Application Received', stage_since: ago(4), last_touch_at: null },
      { id: 'b2', business_id: 'bay', name: 'Nguyen Refi', stage: 'Application/Estimate Sent', stage_since: ago(9), last_touch_at: ago(1) },
      { id: 'b3', business_id: 'bay', name: 'Okafor Purchase', stage: 'Contacted/Working', stage_since: ago(12), last_touch_at: ago(2) },
      { id: 'b4', business_id: 'bay', name: 'Lee Purchase', stage: 'New Lead', stage_since: ago(1), last_touch_at: null },
    ],
    deals: [
      { status: 'won', value: 340000, expected_close: today, business_id: 'bay' },
      { status: 'open', value: 625000, expected_close: null, business_id: 'bay' },
    ],
    mpgRows: [
      { id: 'm1', business_id: 'mpg', name: 'Ana Torres', company: 'Riverside Deli', stage: 'Open', last_touch_at: null },
      { id: 'm2', business_id: 'mpg', name: 'Chris Lee', company: 'Heights Auto', stage: 'Contacted', last_touch_at: ago(1) },
      { id: 'm3', business_id: 'mpg', name: 'Priya Shah', company: 'Oak Spa', stage: 'Qualified', last_touch_at: ago(1) },
    ],
  }
}
