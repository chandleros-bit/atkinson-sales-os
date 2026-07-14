import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import {
  DEFAULT_TARGETS, metricsForTab, resolveTargets, buildTabModel,
  weekStart, monthWindow, rollupMetrics, dailySeries,
  sumWon, countWon, deriveStageCounts, pipelineValue, periodDateFor,
} from '../lib/reports'

const TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'revenue', label: 'Revenue' },
]

const PACE_STYLE = {
  on: { color: 'var(--bay)', bar: 'var(--bay)' },
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
            style={{ background: 'var(--hoverbg)', color: 'var(--dim)' }}
          >
            {card.source === 'manual' ? 'MANUAL' : 'SNAPSHOT'}
          </span>
        )}
      </div>
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
  daily: 'today', weekly: 'this week', monthly: 'this month', revenue: 'this month',
}

function LogMetrics({ tab, biz, values, todayCalls, onSave, saving }) {
  const metrics = metricsForTab(tab, biz).filter((m) => m.source === 'manual')
  const [draft, setDraft] = useState({})
  if (metrics.length === 0) return null
  if (biz === 'all') {
    return (
      <div className="mt-6 rounded-card border border-line bg-panel p-4 text-sm text-muted">
        Pick <b className="text-white">MPG</b> or <b className="text-white">Bayway</b> in the sidebar to log {PERIOD_LABEL[tab]}’s numbers.
      </div>
    )
  }
  return (
    <div className="mt-6 rounded-card border border-line bg-panel p-4">
      <div className="mb-3 text-sm font-semibold">Log {PERIOD_LABEL[tab]}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((m) => (
          <label key={m.key} className="text-xs text-muted">
            {m.label}
            <input
              type="number"
              min="0"
              defaultValue={values[m.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line2 bg-panel2 px-2 py-1.5 text-sm text-white"
            />
            {m.key === 'calls' && biz === 'bay' && (
              <span className="mt-1 block text-[10.5px] text-dim">
                FUB logged {todayCalls} today
              </span>
            )}
          </label>
        ))}
      </div>
      <button
        disabled={saving}
        onClick={() => onSave(draft)}
        className="mt-3 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-[#07120b] disabled:opacity-50"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
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
                className="w-28 rounded-md border border-line2 bg-panel px-2 py-1 text-sm text-white"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-line2 px-3 py-1.5 text-[13px] text-muted">Cancel</button>
          <button
            disabled={saving}
            onClick={() => onSave(draft)}
            className="rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-[#07120b] disabled:opacity-50"
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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    if (isDemoMode) return
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
      const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const [deals, active, bayContacts, mpgContacts, week, month, series, settings, todayCalls] = await Promise.all([
        supabase.from('deals').select('status, value, expected_close, business_id'),
        supabase.from('v_active_pipeline').select('stage, business_id').eq('business_id', 'bay'),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay'),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'mpg'),
        supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', wk),
        supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', from),
        supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', sevenAgo),
        supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        supabase.from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', 'bay').eq('type', 'call').gte('occurred_at', todayStartIso),
      ])
      const err = deals.error || active.error || bayContacts.error || mpgContacts.error || week.error ||
        month.error || series.error || settings.error || todayCalls.error
      if (err) { setError(err.message); return }
      setData({
        deals: deals.data || [],
        activeRows: active.data || [],
        bayContacts: bayContacts.count || 0,
        mpgContacts: mpgContacts.count || 0,
        week: week.data || [],
        month: month.data || [],
        series: series.data || [],
        savedTargets: settings.data?.value || {},
        targets: resolveTargets(DEFAULT_TARGETS, settings.data?.value),
        todayCalls: todayCalls.count || 0,
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
    if (entries.length === 0 || biz === 'all') return
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
    return buildTabModel(metricsForTab(tab, biz), values, data.targets)
  }, [tab, biz, data])

  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">Reports</h2>
      <p className="mt-1 text-sm text-muted">
        Your scoreboard against the Atkinson KPI targets. Live where data is wired; manual otherwise.
      </p>

      <div className="mt-5 flex items-end justify-between border-b border-line">
        <div role="tablist" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${
                tab === t.key ? 'border-white font-semibold text-white' : 'border-transparent text-muted hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!isDemoMode && (
          <button
            onClick={() => setEditing(true)}
            className="mb-1.5 rounded-md border border-line2 px-2.5 py-1 text-[11.5px] text-muted hover:text-white"
          >
            Edit targets
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {isDemoMode && (
        <div className="mt-4 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
          Demo mode — connect Supabase to see live scoreboard data.
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-muted">Loading scoreboard…</div>}
      {!loading && !error && !isDemoMode && <CardGrid cards={cards} />}
      {!loading && !error && !isDemoMode && data && tab === 'daily' && (
        <TrendStrip
          series={dailySeries(
            biz === 'all' ? data.series : data.series.filter((r) => r.business_id === biz),
            'calls', todayKey(), 7,
          )}
        />
      )}
      {!loading && !error && !isDemoMode && data && (
        <LogMetrics
          key={`${tab}-${biz}`}
          tab={tab}
          biz={biz}
          values={computeValues(tab, biz, data)}
          todayCalls={data.todayCalls}
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

// Maps each tab's metric keys to a number. Manual keys come from the
// metrics_daily rollup; live/derived are computed here.
function computeValues(tab, biz, data) {
  const bizFilter = (rows) => (biz === 'all' ? rows : rows.filter((r) => r.business_id === biz))
  if (tab === 'daily') {
    const today = data.series.filter((r) => r.date === todayKey())
    return rollupMetrics(bizFilter(today))
  }
  if (tab === 'weekly') {
    const manual = rollupMetrics(bizFilter(data.week))
    return {
      ...manual,
      weekly_conversations:
        Number(manual.realtor_convos || 0) + Number(manual.bizowner_convos || 0),
    }
  }
  if (tab === 'monthly') {
    const manual = rollupMetrics(bizFilter(data.month))
    const bayDeals = data.deals.filter((d) => d.business_id === 'bay')
    const win = monthWindow()
    const stageCounts = deriveStageCounts(data.activeRows, ['App Sent', 'Pre-Approved'])
    const dbTotal =
      biz === 'all' ? data.bayContacts + data.mpgContacts
      : biz === 'bay' ? data.bayContacts
      : data.mpgContacts
    return {
      ...manual,
      pre_approvals: stageCounts['Pre-Approved'],
      applications: stageCounts['App Sent'],
      loans_closed: countWon(bayDeals, win),
      loan_volume: sumWon(bayDeals, win),
      pipeline_value: pipelineValue(bayDeals),
      db_total: dbTotal,
    }
  }
  // revenue
  const manual = rollupMetrics(bizFilter(data.month))
  const bayDeals = data.deals.filter((d) => d.business_id === 'bay')
  const win = monthWindow()
  const combined = Number(manual.rev_gross_commission || 0) + Number(manual.rev_monthly_residual || 0)
  const closings = countWon(bayDeals, win)
  return {
    ...manual,
    rev_closings: closings,
    rev_loan_volume: sumWon(bayDeals, win),
    rev_combined_income: combined,
    rev_avg_per_closing: safeDiv(manual.rev_gross_commission, closings),
    rev_avg_residual: safeDiv(manual.rev_monthly_residual, manual.rev_active_merchants),
    rev_annualized: combined * 12,
  }
}
