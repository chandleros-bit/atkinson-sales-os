import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import BizBadge from '../components/BizBadge'
import CalendarCard from '../components/CalendarCard'
import MyTasks from '../components/MyTasks'
import CrmLink from '../components/CrmLink'
import { crmProfileUrl } from '../lib/crm'
import {
  deriveAlert,
  sortByAttention,
  lastTouchLabel,
  daysSince,
  isHot,
  isMpgOpen,
  STALE_TOUCH_DAYS,
} from '../lib/overview'
import { LOAN_FLOW_ORDER } from '../lib/pipeline'
import { tierMeta, sortByScore } from '../lib/priorityLeads'
import {
  DEFAULT_TARGETS,
  resolveTargets,
  rollupMetrics,
  dailySeries,
  deriveStageCounts,
  sumWon,
  countWon,
  monthWindow,
  pace,
  formatValue,
} from '../lib/reports'
import {
  todayKey,
  daysAgoKey,
  deltaPill,
  goalPct,
  buildChartModel,
  gaugeArcs,
  compactCurrency,
  initials,
  CHART,
} from '../lib/overviewCards'

const CHART_DAYS = 14
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// Colored text on white: the bright brand hues fail contrast at small sizes,
// so numbers and labels use the deepened *-ink variants while fills stay bright.
function bizColor(biz) {
  return biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
}
function bizInk(biz) {
  return biz === 'mpg' ? 'var(--mpg-ink)' : 'var(--bay-ink)'
}
function bizSoft(biz) {
  return biz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)'
}

function stagePillStyle(stage, biz) {
  if (biz === 'mpg') return { background: 'var(--mpg-soft)', color: 'var(--mpg-ink)' }
  if (stage === 'Waiting on Docs') {
    return { background: 'rgba(232,180,95,.18)', color: 'var(--bay-gold)' }
  }
  return { background: 'var(--bay-soft)', color: 'var(--bay-ink)' }
}

// ---- Chrome ------------------------------------------------------------------

function Card({ className = '', children }) {
  return <section className={`cc-card p-[20px] ${className}`}>{children}</section>
}

function CardHead({ title, sub, right }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[18px] font-bold tracking-tight">{title}</h3>
        {sub && <div className="mt-[3px] text-[12.5px] text-dim">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

function IconLink({ to, label, children }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-panel2 text-muted hover:bg-hoverbg"
    >
      {children}
    </Link>
  )
}

function ArrowOut() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M7 17L17 7M17 7H8M17 7v9" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

function ErrorNote({ error }) {
  if (!error) return null
  return (
    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      {error}
    </div>
  )
}

function AlertBanner({ alert }) {
  if (!alert) return null
  const red = alert.level === 'red'
  return (
    <div
      className="mt-4 rounded-xl border px-3.5 py-2.5 text-xs font-semibold"
      style={
        red
          ? { borderColor: '#FECACA', background: '#FEF2F2', color: '#B91C1C' }
          : {
              borderColor: 'rgba(176,122,31,.35)',
              background: 'rgba(232,180,95,.14)',
              color: 'var(--bay-gold)',
            }
      }
    >
      {alert.text}
    </div>
  )
}

function EmptyRow({ children }) {
  return <div className="px-2 py-10 text-center text-sm text-muted">{children}</div>
}

// ---- 1. KPI scoreboard --------------------------------------------------------

function KpiCard({ card }) {
  const pct = goalPct(card.value, card.goal)
  return (
    <Card className="col-span-1 flex flex-col gap-3 xl:col-span-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="h-[9px] w-[9px] flex-none rounded-full"
            style={{ background: card.accent }}
          />
          <span className="truncate text-[12.5px] font-semibold text-muted">{card.label}</span>
        </div>
        {card.delta && (
          <span
            className="flex-none rounded-full px-2 py-[3px] text-[11.5px] font-bold"
            style={
              card.delta.up === null
                ? { background: 'var(--panel2)', color: 'var(--muted)' }
                : card.delta.up
                  ? { background: 'var(--bay-soft)', color: 'var(--bay-ink)' }
                  : { background: '#FCEBEB', color: '#DC2626' }
            }
          >
            {card.delta.text}
          </span>
        )}
      </div>

      <div className="num text-[34px] font-extrabold leading-none tracking-tight">{card.value}</div>

      <div>
        <div className="h-[7px] overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%`, background: card.accent }}
          />
        </div>
        <div className="mt-[7px] flex items-center justify-between">
          <span className="text-[12px] font-medium text-dim">goal {card.goal}</span>
          <span className="num text-[11.5px] font-bold" style={{ color: card.ink }}>
            {card.value}/{card.goal}
          </span>
        </div>
      </div>
    </Card>
  )
}

// ---- 2. Performance chart -----------------------------------------------------

function LegendDot({ color, children }) {
  return (
    <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-muted">
      <span className="h-[9px] w-[9px] rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}

function PerformanceCard({ model, showBay, showMpg, markerLabel }) {
  return (
    <Card className="col-span-2 xl:col-span-5">
      <CardHead
        title="Performance"
        sub="Daily outbound calls"
        right={
          <span className="flex-none rounded-[11px] border border-line bg-panel2 px-3 py-2 text-[13px] font-semibold text-muted">
            Last {CHART_DAYS} days
          </span>
        }
      />
      <div className="mt-3 flex gap-[18px]">
        {showBay && <LegendDot color="var(--bay)">Bayway</LegendDot>}
        {showMpg && <LegendDot color="var(--mpg)">MPG</LegendDot>}
      </div>

      {model.empty ? (
        <EmptyRow>No call activity logged yet — log a day on Reports.</EmptyRow>
      ) : (
        <svg
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          width="100%"
          className="mt-2 block overflow-visible"
          role="img"
          aria-label={`Daily outbound calls, last ${CHART_DAYS} days`}
        >
          <defs>
            <linearGradient id="bayFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7CAD44" stopOpacity="0.18" />
              <stop offset="1" stopColor="#7CAD44" stopOpacity="0" />
            </linearGradient>
          </defs>
          {model.gridY.map((g) => (
            <g key={g.label}>
              <line
                x1={CHART.x0}
                x2={CHART.x1}
                y1={g.y}
                y2={g.y}
                stroke="var(--line)"
                strokeWidth="1.5"
                strokeDasharray="4 5"
              />
              <text x="12" y={g.ty} fontSize="11" fontWeight="600" fill="var(--dim)">
                {g.label}
              </text>
            </g>
          ))}
          {showBay && model.area && <path d={model.area} fill="url(#bayFill)" />}
          {showMpg && (
            <path
              d={model.mpg}
              fill="none"
              stroke="var(--mpg)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {showBay && (
            <path
              d={model.bay}
              fill="none"
              stroke="var(--bay)"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {model.marker && (
            <>
              <line
                x1={model.marker.x}
                x2={model.marker.x}
                y1={model.marker.y}
                y2={CHART.bottom + 4}
                stroke="var(--accent)"
                strokeWidth="1.4"
                strokeDasharray="3 4"
              />
              <circle
                cx={model.marker.x}
                cy={model.marker.y}
                r="6.5"
                fill="var(--panel)"
                stroke="var(--accent)"
                strokeWidth="3.5"
              />
              <g transform={`translate(${model.marker.x} ${model.marker.y})`}>
                <rect x="-52" y="-58" width="104" height="42" rx="10" fill="var(--text)" />
                <text x="0" y="-38" textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">
                  {model.marker.value} calls
                </text>
                <text x="0" y="-23" textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#8B93A0">
                  {markerLabel}
                </text>
              </g>
            </>
          )}
          {model.xticks.map((t) => (
            <text
              key={t.x}
              x={t.x}
              y={CHART.bottom + 24}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight={t.last ? 800 : 600}
              fill={t.last ? 'var(--accent-ink)' : 'var(--dim)'}
            >
              {t.label}
            </text>
          ))}
        </svg>
      )}
    </Card>
  )
}

// ---- 3. Revenue gauge ---------------------------------------------------------

// Narrow column (~280px at 1600), so the dial sits above its sub-stats rather
// than beside them, and the goal figure rides in the sub-label.
function GaugeCard({ title, sub, value, target, unit, subs }) {
  const pct = target > 0 ? Math.round((value / target) * 100) : 0
  const arcs = gaugeArcs(pct)
  const on = pace(value, target) === 'on'
  const goalText = unit === 'currency' ? compactCurrency(target) : formatValue(target, unit)
  return (
    <Card className="col-span-2 xl:col-span-4">
      <CardHead
        title={title}
        sub={`${sub} · goal ${goalText}`}
        right={
          <span
            className="flex-none rounded-full px-[11px] py-[5px] text-[11.5px] font-bold"
            style={
              on
                ? { background: 'var(--bay-soft)', color: 'var(--bay-ink)' }
                : { background: 'rgba(232,180,95,.18)', color: 'var(--bay-gold)' }
            }
          >
            {on ? 'On track' : 'Behind'}
          </span>
        }
      />
      <div className="mt-1 flex flex-col items-center">
        <svg viewBox="0 0 220 150" width="100%" className="max-w-[210px]">
          <path d={arcs.trackD} fill="none" stroke="var(--line)" strokeWidth="16" strokeLinecap="round" />
          {arcs.valD && (
            <path
              d={arcs.valD}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="16"
              strokeLinecap="round"
            />
          )}
          <text
            x="110"
            y="104"
            textAnchor="middle"
            fontSize="42"
            fontWeight="800"
            fill="var(--text)"
            letterSpacing="-2"
          >
            {pct}%
          </text>
          <text x="110" y="126" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--dim)">
            of {MONTH_NAMES[new Date().getMonth()]} goal
          </text>
        </svg>
        <div className="mt-2 flex w-full gap-2 border-t border-line pt-3.5">
          {subs.map((s) => (
            <div key={s.label} className="min-w-0 flex-1 text-center">
              <div className="num text-[17px] font-extrabold tracking-tight">{s.val}</div>
              <div className="mt-0.5 text-[10.5px] font-semibold leading-tight text-dim">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ---- 4. Funnel card (Bayway pre-approvals / MPG lead pipeline) ----------------

function FunnelCard({ title, sub, to, fillPct, left, right, stats }) {
  return (
    <Card className="col-span-2 xl:col-span-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[18px] font-bold tracking-tight">{title}</h3>
          <div className="mt-[2px] text-[12.5px] text-dim">{sub}</div>
        </div>
        <IconLink to={to} label={`Open ${title}`}>
          <Chevron />
        </IconLink>
      </div>

      <div
        className="mt-[18px] flex h-[22px] overflow-hidden rounded-full"
        style={{ background: 'var(--line)' }}
      >
        <div
          className="rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${fillPct}%`, background: 'var(--accent)' }}
        />
      </div>

      <div className="mt-3.5 flex justify-between">
        <div>
          <div
            className="num text-[24px] font-extrabold tracking-tight"
            style={{ color: 'var(--accent-ink)' }}
          >
            {left.n}
          </div>
          <div className="text-[12px] font-semibold text-dim">{left.label}</div>
        </div>
        <div className="text-right">
          <div className="num text-[24px] font-extrabold tracking-tight">{right.n}</div>
          <div className="text-[12px] font-semibold text-dim">{right.label}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2 border-t border-line pt-4">
        {stats.map((s) => (
          <div key={s.label} className="flex-1 text-center">
            <div className="num text-[16px] font-extrabold">{s.n}</div>
            <div className="mt-0.5 text-[10.5px] font-semibold leading-tight text-dim">{s.label}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---- 5. Needs Attention -------------------------------------------------------

const ATTENTION_COLS = 'grid-cols-[2.4fr_1fr_.8fr_1.1fr]'

function AttentionRow({ r }) {
  const biz = r.business_id
  const isMpg = biz === 'mpg'
  const d = daysSince(r.last_touch_at)
  const stale = d === null || d >= STALE_TOUCH_DAYS
  const headline = (isMpg ? r.company || r.name : r.name) || '(no name)'
  const note = (isMpg ? r.name || r.phone || r.email : r.phone || r.email) || 'no contact info'
  return (
    <div
      className={`grid ${ATTENTION_COLS} items-center gap-3 border-b border-line px-1.5 py-3 last:border-b-0 hover:bg-hoverbg`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[11px]"
          style={{ background: bizSoft(biz) }}
        >
          <span className="h-[9px] w-[9px] rounded-full" style={{ background: bizColor(biz) }} />
        </span>
        <div className="min-w-0">
          <CrmLink url={r.crm_profile_url} className="block truncate text-[14px] font-bold">
            {headline}
          </CrmLink>
          <div className="truncate text-[12px] text-dim">{note}</div>
        </div>
      </div>
      <div>
        <BizBadge biz={biz} />
      </div>
      <div
        className={`num text-[13px] font-semibold ${stale ? '' : 'text-muted'}`}
        style={stale ? { color: 'var(--bay-gold)' } : undefined}
      >
        {lastTouchLabel(r.last_touch_at)}
      </div>
      <div>
        <span
          className="inline-block whitespace-nowrap rounded-full px-[11px] py-[5px] text-[12px] font-bold"
          style={stagePillStyle(r.stage, biz)}
        >
          {r.stage || '—'}
        </span>
      </div>
    </div>
  )
}

function NeedsAttentionCard({ rows, sub, empty, wide }) {
  return (
    <Card className={`col-span-2 ${wide ? 'xl:col-span-12' : 'xl:col-span-8'}`}>
      <CardHead
        title="Needs Attention"
        sub={sub}
        right={
          <IconLink to="/bayway/contacts" label="Open contacts">
            <ArrowOut />
          </IconLink>
        }
      />
      <div
        className={`grid ${ATTENTION_COLS} gap-3 border-b border-line px-1.5 pb-2.5 pt-4 text-[11.5px] font-bold uppercase tracking-wide text-dim`}
      >
        <div>Item</div>
        <div>Business</div>
        <div>Age</div>
        <div>Status</div>
      </div>
      {rows.length === 0 ? (
        <EmptyRow>{empty}</EmptyRow>
      ) : (
        rows.map((r) => <AttentionRow key={`${r.business_id}-${r.id}`} r={r} />)
      )}
    </Card>
  )
}

// ---- 6. Priority Leads --------------------------------------------------------

// v_priority_leads carries no city or loan stage, so the sub-line shows what it
// does have: tier, last touch, score. The round button opens the FUB profile
// (the view has no phone number to dial).
function PriorityLeadsCard({ rows }) {
  return (
    <Card className="col-span-2 xl:col-span-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-bold tracking-tight">Priority Leads</h3>
          <div
            className="mt-[3px] flex items-center gap-1.5 text-[12.5px] font-semibold"
            style={{ color: 'var(--bay-ink)' }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--bay)' }} />
            Bayway
          </div>
        </div>
        <IconLink to="/bayway/priority-leads" label="Open priority leads">
          <ArrowOut />
        </IconLink>
      </div>
      <div className="mt-2 flex flex-col">
        {rows.length === 0 && <EmptyRow>No scored leads yet.</EmptyRow>}
        {rows.map((l) => {
          const meta = tierMeta(l.tier)
          return (
            <div
              key={l.id}
              className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
            >
              <span
                className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full text-[14px] font-extrabold text-white"
                style={{ background: meta.color }}
              >
                {initials(l.name)}
              </span>
              <div className="min-w-0 flex-1">
                <CrmLink url={l.fub_profile_url} className="block truncate text-[14px] font-bold">
                  {l.name || '(no name)'}
                </CrmLink>
                <div className="truncate text-[12px] text-dim">
                  {meta.label} · {lastTouchLabel(l.last_activity_at)}
                  {l.score != null && ` · score ${Math.round(l.score)}`}
                </div>
              </div>
              <CrmLink
                url={l.fub_profile_url}
                title="Open in FollowUpBoss"
                className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[11px]"
              >
                <span
                  className="grid h-[38px] w-[38px] place-items-center rounded-[11px]"
                  style={{ background: 'var(--bay-soft)', color: 'var(--bay-ink)' }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                </span>
              </CrmLink>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---- Data ---------------------------------------------------------------------

// Bayway HOT rows for Needs Attention: every Bayway contact tagged HOT (any
// stage, incl. nurture). taggedRows carry raw.tags; pipelineRows supply the
// loan stage for the pill, defaulting to 'Nurture' when the contact has none.
function buildBayHotRows(taggedRows, pipelineRows) {
  const stageById = new Map((pipelineRows || []).map((r) => [r.id, r.stage]))
  return (taggedRows || [])
    .filter((c) => isHot(c.tags))
    .map((c) => ({
      ...c,
      business_id: 'bay',
      stage: stageById.get(c.id) || 'Nurture',
      // Rows come off the contacts table (not a view), so build the FUB link here.
      crm_profile_url: crmProfileUrl('bay', c.external_id),
    }))
}

// One fetch for every card, scoped to the active book. Bayway-only sources
// (pipeline, deals, priority leads) are skipped in the MPG view and vice versa,
// so a single-book view never pays for the other book's queries.
function useCommandCenter(biz) {
  const [data, setData] = useState(null)
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
        const { from: monthStart } = monthWindow()
        // One metrics read covers every window the cards need: today, yesterday
        // (delta pills), the 14-day chart, and month-to-date manual revenue rows
        // — which land on the 1st and can fall outside the 14-day window.
        const metricsFrom = [daysAgoKey(CHART_DAYS - 1), monthStart].sort()[0]

        const q = {
          metrics: supabase
            .from('metrics_daily')
            .select('date, business_id, metric_key, value')
            .gte('date', metricsFrom),
          settings: supabase
            .from('settings')
            .select('value')
            .eq('key', 'metric_targets')
            .maybeSingle(),
          sync: supabase
            .from('sync_log')
            .select('ran_at, status, message')
            .eq('source', 'fub')
            .order('ran_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          // v_tasks is open-only. The combined view counts both books; a
          // single-book view scopes the banner to that book, as before.
          tasks:
            biz === 'all'
              ? supabase.from('v_tasks').select('id, business_id, due_at')
              : supabase.from('v_tasks').select('id, business_id, due_at').eq('business_id', biz),
        }
        if (wantsBay) {
          q.bayPipe = supabase
            .from('v_active_pipeline')
            .select('id, business_id, name, email, phone, last_touch_at, stage')
            .eq('business_id', 'bay')
          q.bayTagged = supabase
            .from('contacts')
            .select('id, name, email, phone, last_touch_at, external_id, tags:raw->tags')
            .eq('business_id', 'bay')
          q.bayCount = supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', 'bay')
          q.deals = supabase
            .from('deals')
            .select('status, value, expected_close, business_id')
            .eq('business_id', 'bay')
          q.leads = supabase
            .from('v_priority_leads')
            .select('id, name, score, tier, last_activity_at, fub_profile_url')
            .eq('business_id', 'bay')
        }
        if (wantsMpg) {
          q.mpgLeads = supabase
            .from('v_mpg_contacts')
            .select('id, name, company, email, phone, last_touch_at, stage, crm_profile_url')
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

        const bayPipe = res.bayPipe?.data || []
        setData({
          metrics: res.metrics.data || [],
          targets: resolveTargets(DEFAULT_TARGETS, res.settings.data?.value),
          latestSync: res.sync.data,
          tasks: res.tasks.data || [],
          bayPipe,
          bayHot: buildBayHotRows(res.bayTagged?.data, bayPipe),
          bayContacts: res.bayCount?.count || 0,
          deals: res.deals?.data || [],
          leads: res.leads?.data || [],
          mpgRows: (res.mpgLeads?.data || []).map((r) => ({ ...r, business_id: 'mpg' })),
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

// The daily activity scoreboard. The combined view splits calls by book; a
// single-book view shows that book's four daily metrics instead.
// Per-book call goals are half the combined `calls` target, so the two book
// cards always add up to the combined card's goal.
function buildKpiCards(biz, metrics, targets) {
  const tKey = todayKey()
  const yKey = daysAgoKey(1)
  const forDay = (key, b) =>
    rollupMetrics(metrics.filter((r) => r.date === key && (!b || r.business_id === b)))
  const today = forDay(tKey, null)
  const yesterday = forDay(yKey, null)

  const card = (label, key, accent, ink, goal, todayVals = today, yVals = yesterday) => ({
    label,
    value: Number(todayVals[key] || 0),
    goal,
    accent,
    ink,
    delta: deltaPill(todayVals[key], yVals[key]),
  })

  if (biz === 'all') {
    const bayToday = forDay(tKey, 'bay')
    const bayYest = forDay(yKey, 'bay')
    const mpgToday = forDay(tKey, 'mpg')
    const mpgYest = forDay(yKey, 'mpg')
    const half = Math.round(targets.calls / 2)
    return [
      card('Outbound Calls · Today', 'calls', 'var(--text)', 'var(--text)', targets.calls),
      card('Bayway Calls · Today', 'calls', 'var(--bay)', 'var(--bay-ink)', half, bayToday, bayYest),
      card('MPG Calls · Today', 'calls', 'var(--mpg)', 'var(--mpg-ink)', half, mpgToday, mpgYest),
      card(
        'Live Conversations · Today',
        'live_conversations',
        'var(--bay)',
        'var(--bay-ink)',
        targets.live_conversations,
      ),
    ]
  }

  const accent = bizColor(biz)
  const ink = bizInk(biz)
  const bookToday = forDay(tKey, biz)
  const bookYest = forDay(yKey, biz)
  const one = (label, key, goal) => card(label, key, accent, ink, goal, bookToday, bookYest)
  return [
    one('Outbound Calls · Today', 'calls', targets.calls),
    one('Live Conversations · Today', 'live_conversations', targets.live_conversations),
    one('Follow-ups · Today', 'followups', targets.followups),
    one('New Contacts · Today', 'new_contacts', targets.new_contacts),
  ]
}

// Assembles every card's props from one fetch. Pure over `data`, so the whole
// screen re-derives from a single memo.
function buildView(biz, data) {
  const { metrics, targets, deals, bayPipe, bayHot, mpgRows, bayContacts } = data
  const tKey = todayKey()
  const win = monthWindow()

  const seriesFor = (b) =>
    dailySeries(metrics.filter((r) => r.business_id === b), 'calls', tKey, CHART_DAYS)
  const chart = buildChartModel(
    {
      bay: biz === 'mpg' ? [] : seriesFor('bay'),
      mpg: biz === 'bay' ? [] : seriesFor('mpg'),
    },
    tKey,
    biz === 'mpg' ? 'mpg' : 'bay',
  )

  const monthRows = metrics.filter((r) => r.date >= win.from && r.date < win.to)
  const mpgMonth = rollupMetrics(monthRows.filter((r) => r.business_id === 'mpg'))

  const mpgOpen = mpgRows.filter((r) => isMpgOpen(r.stage))
  const attentionRows =
    biz === 'bay' ? sortByAttention(bayHot)
    : biz === 'mpg' ? sortByAttention(mpgOpen)
    : sortByAttention([...bayHot, ...mpgOpen])

  const attention = {
    rows: attentionRows,
    sub: `${attentionRows.length} item${attentionRows.length === 1 ? '' : 's'} · sorted by longest since last touch`,
    empty:
      biz === 'bay' ? 'No HOT-tagged contacts — tag a lead HOT in FollowUpBoss.'
      : biz === 'mpg' ? 'No open MPG leads — set a lead to Open in Zoho CRM.'
      : 'No HOT Bayway or open MPG contacts right now.',
  }

  // MPG revenue is a manual monthly residual; Bayway is live closed volume.
  // Each book's gauge tracks its own unit rather than summing dollars that mean
  // different things — the other book's number rides along as a sub-stat.
  const bayVolume = sumWon(deals, win)
  const gauge =
    biz === 'mpg'
      ? {
          title: 'Revenue Goal',
          sub: 'Monthly residual · MPG',
          value: Number(mpgMonth.rev_monthly_residual || 0),
          target: targets.rev_monthly_residual,
          unit: 'currency',
          subs: [
            { label: 'Monthly residual', val: compactCurrency(mpgMonth.rev_monthly_residual) },
            { label: 'Active merchants', val: String(mpgMonth.rev_active_merchants || 0) },
          ],
        }
      : {
          title: 'Revenue Goal',
          sub: 'Loan volume MTD · Bayway',
          value: bayVolume,
          target: targets.loan_volume,
          unit: 'currency',
          subs: [
            { label: 'Bayway volume', val: compactCurrency(bayVolume) },
            biz === 'all'
              ? { label: 'MPG residual', val: compactCurrency(mpgMonth.rev_monthly_residual) }
              : { label: 'Contacts', val: String(bayContacts) },
            { label: 'Deals in play', val: String(deals.filter((d) => d.status === 'open').length) },
          ],
        }

  let funnel
  if (biz === 'mpg') {
    const stageCounts = [
      ...mpgRows.reduce((m, l) => {
        const s = l.stage || '—'
        return m.set(s, (m.get(s) || 0) + 1)
      }, new Map()),
    ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    funnel = {
      title: 'Lead Pipeline',
      sub: 'MPG · Zoho lead stages',
      to: '/mpg/pipeline',
      fillPct: goalPct(mpgOpen.length, mpgRows.length || 1),
      left: { n: mpgOpen.length, label: 'Open' },
      right: { n: mpgRows.length, label: 'All leads' },
      stats: stageCounts.slice(0, 4).map(([label, n]) => ({ label, n })),
    }
  } else {
    // The Bayway board has no underwriting/CTC/funded stage — the funnel footer
    // uses the real v_active_pipeline stages plus funded loans from `deals`.
    const counts = deriveStageCounts(bayPipe, LOAN_FLOW_ORDER)
    const preApproved = counts['Pre-Approved'] || 0
    funnel = {
      title: 'Pre-Approvals',
      sub: 'Bayway · active pipeline',
      to: '/bayway/pipeline',
      fillPct: goalPct(preApproved, bayPipe.length || 1),
      left: { n: preApproved, label: 'Pre-Approved' },
      right: { n: bayPipe.length, label: 'In Pipeline' },
      stats: [
        { label: 'App Sent', n: counts['App Sent'] || 0 },
        { label: 'Waiting on Docs', n: counts['Waiting on Docs'] || 0 },
        { label: 'Pre-Approved', n: preApproved },
        { label: 'Funded MTD', n: countWon(deals, win) },
      ],
    }
  }

  return {
    alert: deriveAlert({ latestSync: data.latestSync, tasks: data.tasks }),
    kpis: buildKpiCards(biz, metrics, targets),
    chart,
    gauge,
    funnel,
    attention,
    leads: sortByScore(data.leads).slice(0, 5),
  }
}

// ---- Screen -------------------------------------------------------------------

export default function Overview() {
  const { biz } = useBusiness()
  const { data, loading, error } = useCommandCenter(biz)

  const subtitle =
    biz === 'bay' ? 'Bayway view — mortgage only.'
    : biz === 'mpg' ? 'MPG view — merchant services only.'
    : 'Here is what is happening across MPG and Bayway today.'

  const view = useMemo(() => (data ? buildView(biz, data) : null), [biz, data])

  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <ErrorNote error={error} />
      {isDemoMode && (
        <div className="mt-4 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-xs text-muted">
          Demo mode — connect Supabase to see live command-center data.
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-muted">Loading command center…</div>}

      {!loading && !error && view && (
        <>
          <AlertBanner alert={view.alert} />

          {/* The rail only splits off at 2xl: at 1280 the main region would be
              ~560px, which crushes the 12-column grid inside it. */}
          <div className="mt-5 grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_384px]">
            <div className="grid grid-cols-2 items-start gap-5 xl:grid-cols-12">
              {view.kpis.map((c) => (
                <KpiCard key={c.label} card={c} />
              ))}

              <PerformanceCard
                model={view.chart}
                showBay={biz !== 'mpg'}
                showMpg={biz !== 'bay'}
                markerLabel={`Today · ${biz === 'mpg' ? 'MPG' : 'Bayway'}`}
              />

              <GaugeCard {...view.gauge} />
              <FunnelCard {...view.funnel} />

              <NeedsAttentionCard
                rows={view.attention.rows}
                sub={view.attention.sub}
                empty={view.attention.empty}
                wide={biz === 'mpg'}
              />

              {biz !== 'mpg' && <PriorityLeadsCard rows={view.leads} />}
            </div>

            <div className="flex flex-col gap-5">
              <MyTasks />
              <CalendarCard />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
