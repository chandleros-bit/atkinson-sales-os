import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import {
  DEFAULT_TARGETS, metricsForTab, resolveTargets, buildTabModel,
  weekStart, monthWindow, rollupMetrics,
  sumWon, countWon, deriveStageCounts,
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

export default function Reports() {
  const { biz } = useBusiness()
  const [tab, setTab] = useState('daily')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const wk = weekStart()
        const { from } = monthWindow()
        const [deals, active, bayContacts, mpgContacts, week, month, settings] = await Promise.all([
          supabase.from('deals').select('status, value, expected_close, business_id'),
          supabase.from('v_active_pipeline').select('stage, business_id').eq('business_id', 'bay'),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay'),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'mpg'),
          supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', wk),
          supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', from),
          supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        ])
        if (!alive) return
        const err = deals.error || active.error || bayContacts.error || mpgContacts.error || week.error || month.error || settings.error
        if (err) { setError(err.message); return }
        setData({
          deals: deals.data || [],
          activeRows: active.data || [],
          bayContacts: bayContacts.count || 0,
          mpgContacts: mpgContacts.count || 0,
          week: week.data || [],
          month: month.data || [],
          targets: resolveTargets(DEFAULT_TARGETS, settings.data?.value),
        })
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

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

      <div role="tablist" className="mt-5 flex gap-1 border-b border-line">
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
    </div>
  )
}

// Maps each tab's metric keys to a number. Manual keys come from the
// metrics_daily rollup; live/derived are computed here.
function computeValues(tab, biz, data) {
  const bizFilter = (rows) => (biz === 'all' ? rows : rows.filter((r) => r.business_id === biz))
  if (tab === 'daily') {
    return rollupMetrics(bizFilter(data.week))
  }
  if (tab === 'weekly') {
    return rollupMetrics(bizFilter(data.week))
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
      db_total: dbTotal,
    }
  }
  // revenue
  const manual = rollupMetrics(bizFilter(data.month))
  const bayDeals = data.deals.filter((d) => d.business_id === 'bay')
  const win = monthWindow()
  const combined = Number(manual.rev_gross_commission || 0) + Number(manual.rev_monthly_residual || 0)
  return {
    ...manual,
    rev_closings: countWon(bayDeals, win),
    rev_loan_volume: sumWon(bayDeals, win),
    rev_combined_income: combined,
  }
}
