import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { useBusiness } from '../context/BusinessContext'
import {
  DEFAULT_TARGETS, metricsForTab, resolveTargets, buildTabModel,
  weekStart, monthWindow, rollupMetrics, dailySeries,
  deriveStageCounts, periodDateFor,
  sprintRows, sprintWindow, MPG_SPRINT, callsByDay, callsSince, ARIVE_KEYS,
} from '../lib/reports'
import { fetchLoanBundle } from '../lib/loansData'
import { loanStats, DEFAULT_RATES } from '../lib/loans'
import { prevMonthWindow } from '../lib/overviewDash'
import PageHeader from '../components/PageHeader'

const TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'sprint', label: 'Sprint' },
]

const PACE_STYLE = {
  on: { color: 'var(--bay-ink)', bar: 'var(--bay)' },
  behind: { color: 'var(--bay-gold)', bar: 'var(--bay-gold)' },
  none: { color: 'var(--muted)', bar: 'var(--line2)' },
}

function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Returns null (renders as "—", pace "none") rather than NaN/Infinity when the
// denominator is missing — an unknown average must not read as $0.
function safeDiv(numerator, denominator) {
  const n = Number(numerator || 0)
  const d = Number(denominator || 0)
  if (!d) return null
  return n / d
}

function MetricCard({ card }) {
  const s = PACE_STYLE[card.pace]
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <div className="num text-[26px] font-bold leading-none tracking-tight" style={{ color: s.color }}>
          {card.valueText}
        </div>
        <div className="num text-[12px] text-dim">/ {card.targetText}</div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        {card.label}
        {card.source !== 'live' && (
          <span
            className="rounded px-1 py-px text-[9px] font-semibold tracking-wide"
            style={{ background: 'var(--hover)', color: 'var(--dim)' }}
          >
            {card.source === 'manual' ? 'MANUAL' : 'SNAPSHOT'}
          </span>
        )}
      </div>
      {card.note && <div className="mt-1 text-[11px] text-dim">{card.note}</div>}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
        <div className="h-full rounded-full" style={{ width: `${card.pct}%`, background: s.bar }} />
      </div>
    </div>
  )
}

function CardGrid({ cards }) {
  if (cards.length === 0) {
    return <p className="mt-6 text-sm text-muted">No metrics for this view.</p>
  }
  return (
    <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => <MetricCard key={c.key} card={c} />)}
    </div>
  )
}

const PERIOD_LABEL = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
  revenue: 'this month',
  sprint: 'today’s sprint progress',
}

function LogMetrics({ tab, biz, values, syncedCalls, onSave, saving }) {
  const metrics = metricsForTab(tab, biz).filter((m) => m.source === 'manual')
  const [draft, setDraft] = useState({})
  if (metrics.length === 0) return null
  if (biz === 'all') {
    return (
      <div className="mt-6 rounded-card border border-line bg-panel p-4 text-sm text-muted">
        Pick <b className="text-[color:var(--text)]">MPG</b> or <b className="text-[color:var(--text)]">Bayway</b> in the sidebar to log {PERIOD_LABEL[tab]}’s numbers.
      </div>
    )
  }
  return (
    <div className="mt-6 rounded-card border border-line bg-panel p-4">
      <div className="mb-3 text-sm font-semibold">Log {PERIOD_LABEL[tab]}</div>
      {tab === 'sprint' && (
        <div className="mb-3 rounded-md border border-line bg-panel2 px-3 py-2 text-[11.5px] text-muted">
          Enter the increments completed today. The Sprint tab sums MPG progress across {MPG_SPRINT.label}.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((m) => (
          <label key={m.key} className="text-xs text-muted">
            {m.label}
            <input
              type="number"
              min="0"
              defaultValue={values[m.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line2 bg-panel2 px-2 py-1.5 text-sm text-[color:var(--text)]"
            />
            {m.key === 'calls' && (
              <span className="mt-1 block text-[10.5px] text-dim">
                Auto: {syncedCalls} outbound calls synced today — add any made outside the CRM
              </span>
            )}
          </label>
        ))}
      </div>
      <button
        disabled={saving}
        onClick={() => onSave(draft)}
        className="mt-3 rounded-md bg-[color:var(--text)] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function TrendStrip({ series }) {
  const max = Math.max(1, ...series)
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const start = new Date(); start.setDate(start.getDate() - 6)
  return (
    <div className="mt-6 rounded-card border border-line bg-panel p-4">
      <div className="mb-3 text-xs font-semibold text-muted">Calls · last 7 days</div>
      <div className="flex items-end gap-2" style={{ height: 64 }}>
        {series.map((v, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i)
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div className="w-full rounded-sm" style={{ height: `${(v / max) * 100}%`, minHeight: 2, background: 'var(--bay)' }} />
              </div>
              <span className="num text-[10px] text-dim">{DOW[d.getDay()]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EditTargets({ tab, biz, targets, onClose, onSave, saving }) {
  const metrics = metricsForTab(tab, biz)
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(metrics.map((m) => [m.key, targets[m.key] ?? ''])),
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card border border-line bg-panel2 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold">Edit targets — {tab}</div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {metrics.map((m) => (
            <label key={m.key} className="flex items-center justify-between gap-3 text-xs text-muted">
              {m.label}
              <input
                type="number" min="0"
                value={draft[m.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
                className="w-28 rounded-md border border-line2 bg-panel px-2 py-1 text-sm text-[color:var(--text)]"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-line2 px-3 py-1.5 text-[13px] text-muted">Cancel</button>
          <button
            disabled={saving}
            onClick={() => onSave(draft)}
            className="rounded-md bg-[color:var(--text)] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save targets'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Reports() {
  const { biz } = useBusiness()
  const [tab, setTab] = useState('daily')
  const [data, setData] = useState(() => (isDemoMode ? demoReportsData() : null))
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    if (isDemoMode) {
      setData(demoReportsData())
      return
    }
    setLoading(true)
    setError(null)
    try {
      const wk = weekStart()
      const { from } = monthWindow()
      const sevenAgo = (() => {
        const d = new Date(); d.setDate(d.getDate() - 6)
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      })()
      const earliestStartIso = (() => {
        const sevenAgoMidnight = new Date(); sevenAgoMidnight.setHours(0, 0, 0, 0); sevenAgoMidnight.setDate(sevenAgoMidnight.getDate() - 6)
        const wkStart = new Date(`${wk}T00:00:00`)
        const moStart = new Date(`${from}T00:00:00`)
        return new Date(Math.min(sevenAgoMidnight.getTime(), wkStart.getTime(), moStart.getTime())).toISOString()
      })()
      const sprint = sprintWindow()
      const [active, bayContacts, mpgContacts, week, month, sprintMetrics, series, settings, callRows, loanBundle] = await Promise.all([
        fetchAllSettled(() => supabase.from('v_active_pipeline').select('stage, business_id').eq('business_id', 'bay').order('id')),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay'),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'mpg'),
        supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', wk),
        supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', from),
        // The sprint window is ~90 days: page it.
        fetchAllSettled(() => supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', sprint.from).lt('date', sprint.to).order('id')),
        supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', sevenAgo),
        supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        // Up to 31 days of outbound calls across both books can pass 1,000.
        fetchAllSettled(() => supabase.from('activities')
          .select('occurred_at, business_id')
          .eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', earliestStartIso)
          .order('id')),
        fetchLoanBundle(),
      ])
      const err = active.error || bayContacts.error || mpgContacts.error || week.error ||
        month.error || sprintMetrics.error || series.error || settings.error || callRows.error || loanBundle.error
      if (err) { setError(err.message); return }
      setData({
        activeRows: active.data || [],
        bayContacts: bayContacts.count || 0,
        mpgContacts: mpgContacts.count || 0,
        week: week.data || [],
        month: month.data || [],
        sprint: sprintMetrics.data || [],
        series: series.data || [],
        savedTargets: settings.data?.value || {},
        targets: resolveTargets(DEFAULT_TARGETS, settings.data?.value),
        callRows: callRows.data || [],
        loans: loanBundle.data?.loans || [],
        loanRates: loanBundle.data?.rates || DEFAULT_RATES,
        lastLoanImport: loanBundle.data?.lastImport || null,
      })
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveMetrics(draft) {
    const entries = Object.entries(draft).filter(([, v]) => v !== '' && v != null)
    if (entries.length === 0 || biz === 'all' || isDemoMode) return
    setSaving(true)
    const date = periodDateFor(tab)
    const rows = entries.map(([metric_key, v]) => ({
      business_id: biz, date, metric_key, value: Number(v),
    }))
    const { error: upErr } = await supabase
      .from('metrics_daily')
      .upsert(rows, { onConflict: 'business_id,date,metric_key' })
    setSaving(false)
    if (upErr) { setError(upErr.message); return }
    await load()
  }

  async function saveTargets(draft) {
    setSaving(true)
    const clean = Object.fromEntries(
      Object.entries(draft).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]),
    )
    const merged = { ...(data.savedTargets || {}), ...clean }
    const { error: upErr } = await supabase
      .from('settings')
      .upsert({ key: 'metric_targets', value: merged }, { onConflict: 'key' })
    setSaving(false)
    if (upErr) { setError(upErr.message); return }
    setEditing(false)
    await load()
  }

  const cards = useMemo(() => {
    if (!data) return []
    const values = computeValues(tab, biz, data)
    return buildTabModel(metricsForTab(tab, biz), values, data.targets, ariveNotes(data))
  }, [tab, biz, data])

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Your scoreboard against the Atkinson KPI targets. Live where data is wired; manual otherwise."
      />

      <div className="mt-5 flex items-end justify-between border-b border-line">
        <div role="tablist" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${
                tab === t.key ? 'border-[color:var(--text)] font-semibold text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!isDemoMode && (
          <button
            onClick={() => setEditing(true)}
            className="mb-1.5 rounded-md border border-line2 px-2.5 py-1 text-[11.5px] text-muted hover:text-[color:var(--text)]"
          >
            Edit targets
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {isDemoMode && (
        <div className="mt-4 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
          Demo mode — showing sample scoreboard data. Connect Supabase to save entries.
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-muted">Loading scoreboard…</div>}
      {!loading && !error && <CardGrid cards={cards} />}
      {!loading && !error && data && tab === 'daily' && (() => {
        const manualSeries = dailySeries(
          biz === 'all' ? data.series : data.series.filter((r) => r.business_id === biz),
          'calls', todayKey(), 7,
        )
        const syncedRows = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
        const byDay = callsByDay(syncedRows)
        const start = new Date(); start.setDate(start.getDate() - 6)
        const pad = (n) => String(n).padStart(2, '0')
        const combined = manualSeries.map((v, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i)
          const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
          return v + (byDay[key] || 0)
        })
        return <TrendStrip series={combined} />
      })()}
      {!loading && !error && data && (
        <LogMetrics
          key={`${tab}-${biz}`}
          tab={tab}
          biz={biz}
          values={computeValues(tab, biz, data)}
          syncedCalls={(() => {
            const rows = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
            return callsByDay(rows)[todayKey()] || 0
          })()}
          onSave={saveMetrics}
          saving={saving}
        />
      )}
      {editing && data && (
        <EditTargets
          tab={tab}
          biz={biz}
          targets={data.targets}
          onClose={() => setEditing(false)}
          onSave={saveTargets}
          saving={saving}
        />
      )}
    </div>
  )
}

function demoReportsData() {
  const today = todayKey()
  const monthFirst = today.slice(0, 8) + '01'
  const sprintDemo = [
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_outbound_attempts', value: 210 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_live_conversations', value: 42 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_completed_applications', value: 8 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_qualified_preapprovals', value: 5 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_contracts_refis', value: 2 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_funded_loans', value: 1 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_referral_touches', value: 38 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_pipeline_under_contract', value: 1 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_pipeline_preapproved', value: 3 },
    { date: MPG_SPRINT.from, business_id: 'bay', metric_key: 'bay_pipeline_waiting_docs', value: 8 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_targeted_contacts', value: 120 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_owner_conversations', value: 32 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_discovery_meetings', value: 9 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_statements_received', value: 7 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_statements_analyzed', value: 6 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_proposals_sent', value: 4 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_merchants_signed', value: 2 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_merchants_activated', value: 1 },
    { date: MPG_SPRINT.from, business_id: 'mpg', metric_key: 'mpg_qualified_future_pipeline', value: 5 },
  ]
  const month = [
    { date: monthFirst, business_id: 'bay', metric_key: 'realtor_meetings', value: 3 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'businesses_contacted', value: 120 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'owner_conversations', value: 32 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'merchant_proposals_delivered', value: 4 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'new_merchant_accounts', value: 2 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'new_residual', value: 640 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'rev_active_merchants', value: 2 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'rev_monthly_residual', value: 640 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'rev_processing_volume', value: 86000 },
  ]
  const series = [
    { date: today, business_id: 'bay', metric_key: 'calls', value: 24 },
    { date: today, business_id: 'bay', metric_key: 'live_conversations', value: 5 },
    { date: today, business_id: 'bay', metric_key: 'followups', value: 8 },
    { date: today, business_id: 'mpg', metric_key: 'calls', value: 18 },
    { date: today, business_id: 'mpg', metric_key: 'live_conversations', value: 4 },
    { date: today, business_id: 'mpg', metric_key: 'followups', value: 6 },
    { date: today, business_id: 'mpg', metric_key: 'new_contacts', value: 3 },
  ]
  return {
    activeRows: [
      { stage: 'Application Received', business_id: 'bay' },
      { stage: 'Application/Estimate Sent', business_id: 'bay' },
      { stage: 'Application/Estimate Sent', business_id: 'bay' },
    ],
    bayContacts: 826,
    mpgContacts: 42,
    week: [
      { business_id: 'bay', metric_key: 'realtor_convos', value: 18 },
      { business_id: 'mpg', metric_key: 'bizowner_convos', value: 32 },
      { business_id: 'mpg', metric_key: 'merchant_proposals', value: 4 },
    ],
    month,
    sprint: sprintDemo,
    series: [...series, ...month, ...sprintDemo],
    savedTargets: {},
    targets: resolveTargets(DEFAULT_TARGETS, null),
    callRows: [
      { occurred_at: new Date().toISOString(), business_id: 'bay' },
      { occurred_at: new Date().toISOString(), business_id: 'bay' },
      { occurred_at: new Date().toISOString(), business_id: 'mpg' },
    ],
    loans: [],
    loanRates: DEFAULT_RATES,
    lastLoanImport: null,
  }
}

// Arive numbers for the switched metrics; every key null before the first import.
function ariveValues(data) {
  const s = loanStats(data.loans, data.loanRates, { month: monthWindow(), prev: prevMonthWindow(), sprint: sprintWindow() })
  if (!s) return Object.fromEntries(ARIVE_KEYS.map((k) => [k, null]))
  return {
    loans_closed: s.closed, loan_volume: s.volume, pipeline_value: s.pipeline,
    rev_closings: s.closed, rev_loan_volume: s.volume, rev_gross_commission: s.commission,
    bay_funded_loans: s.sprintFunded,
  }
}

function ariveNotes(data) {
  const text = !data.loans.length
    ? 'no Arive import yet'
    : `Arive · imported ${new Date(data.lastLoanImport?.ran_at || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return Object.fromEntries(ARIVE_KEYS.map((k) => [k, text]))
}

// Maps each tab's metric keys to a number. Manual keys come from the
// metrics_daily rollup; live/derived are computed here.
function computeValues(tab, biz, data) {
  const bizFilter = (rows) => (biz === 'all' ? rows : rows.filter((r) => r.business_id === biz))
  if (tab === 'daily') {
    const today = data.series.filter((r) => r.date === todayKey())
    const manual = rollupMetrics(bizFilter(today))
    const syncedToday = callsByDay(bizFilter(data.callRows))[todayKey()] || 0
    return { ...manual, calls: Number(manual.calls || 0) + syncedToday }
  }
  if (tab === 'weekly') {
    const manual = rollupMetrics(bizFilter(data.week))
    return {
      ...manual,
      weekly_conversations:
        Number(manual.realtor_convos || 0) + Number(manual.bizowner_convos || 0),
      calls_weekly: Number(manual.calls || 0) + callsSince(bizFilter(data.callRows), weekStart()),
    }
  }
  if (tab === 'monthly') {
    const manual = rollupMetrics(bizFilter(data.month))
    const win = monthWindow()
    const arive = ariveValues(data)
    // Board columns from the FUB stage tags (bay-stages.ts).
    const stageCounts = deriveStageCounts(data.activeRows, ['Application/Estimate Sent', 'Application Received', 'Disclosed'])
    const dbTotal =
      biz === 'all' ? data.bayContacts + data.mpgContacts
      : biz === 'bay' ? data.bayContacts
      : data.mpgContacts
    return {
      ...manual,
      // Disclosed files were pre-approved first (they sat in Application Received).
      pre_approvals: stageCounts['Application Received'] + stageCounts.Disclosed,
      applications: stageCounts['Application/Estimate Sent'],
      loans_closed: arive.loans_closed,
      loan_volume: arive.loan_volume,
      pipeline_value: arive.pipeline_value,
      db_total: dbTotal,
      calls_monthly: Number(manual.calls || 0) + callsSince(bizFilter(data.callRows), win.from),
    }
  }
  if (tab === 'sprint') {
    return { ...rollupMetrics(bizFilter(sprintRows(data.sprint))), bay_funded_loans: ariveValues(data).bay_funded_loans }
  }
  // revenue
  const manual = rollupMetrics(bizFilter(data.month))
  const arive = ariveValues(data)
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
