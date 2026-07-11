import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import BizBadge from '../components/BizBadge'
import {
  buildKpis,
  deriveAlert,
  sortByAttention,
  lastTouchLabel,
  daysSince,
  STALE_TOUCH_DAYS,
} from '../lib/overview'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function stagePillStyle(stage) {
  if (stage === 'Waiting on Docs') {
    return { background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }
  }
  return { background: 'var(--bay-soft)', color: 'var(--bay)' }
}

export default function Overview() {
  const { biz } = useBusiness()
  const [rows, setRows] = useState([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [latestSync, setLatestSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const [pipeline, contactCount, sync] = await Promise.all([
        supabase
          .from('v_active_pipeline')
          .select('id, business_id, name, email, phone, last_touch_at, stage')
          .eq('business_id', 'bay'),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay'),
        supabase
          .from('sync_log')
          .select('ran_at, status, message')
          .eq('source', 'fub')
          .order('ran_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      const err = pipeline.error || contactCount.error || sync.error
      if (err) {
        setError(err.message)
        return
      }
      setRows(pipeline.data || [])
      setTotalContacts(contactCount.count || 0)
      setLatestSync(sync.data)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (isDemoMode) return <DemoOverview />
  if (biz === 'mpg') return <MpgPlaceholder />

  const kpis = buildKpis(rows, totalContacts)
  const alert = !loading && !error ? deriveAlert({ latestSync, rows }) : null
  const workbench = sortByAttention(rows)

  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">
        {biz === 'bay'
          ? 'Bayway view — mortgage only.'
          : 'Here is what is happening across MPG and Bayway today.'}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading pipeline…</div>}

      {!loading && !error && (
        <>
          {alert && (
            <div
              className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                alert.level === 'red'
                  ? 'border-red-900/60 bg-red-950/40 text-red-300'
                  : 'border-[rgba(232,180,95,.4)] bg-[rgba(232,180,95,.1)] text-[#e8b45f]'
              }`}
            >
              {alert.text}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <Kpi label="Active loans" value={kpis.activeLoans} />
            {kpis.stageCards.map((c) => (
              <Kpi key={c.label} label={c.label} value={c.count} accent />
            ))}
            <Kpi label="New leads" value={kpis.newLeads} />
          </div>
          <p className="mt-2.5 text-[11.5px] text-dim">
            <span className="num font-semibold text-muted">{kpis.nurture}</span> in nurture
            · MPG connects with Zoho in a later phase
          </p>

          <div className="mt-5 rounded-card border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--bay)' }} />
                Needs Attention
                <span className="num text-[11px] font-medium text-muted">{workbench.length}</span>
              </div>
              <span className="text-xs text-dim">Sorted by longest since last touch</span>
            </div>
            {workbench.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-muted">
                No active loans — add stages in FollowUpBoss.
              </div>
            )}
            {workbench.map((r) => {
              const d = daysSince(r.last_touch_at)
              const stale = d === null || d >= STALE_TOUCH_DAYS
              return (
                <div
                  key={r.id}
                  className="relative flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                >
                  <span
                    className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
                    style={{ background: r.business_id === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{r.name || '(no name)'}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                      <BizBadge biz={r.business_id} />
                      {r.phone || r.email || 'no contact info'}
                    </div>
                  </div>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={stagePillStyle(r.stage)}
                  >
                    {r.stage}
                  </span>
                  <span
                    className={`w-20 whitespace-nowrap text-right text-[11.5px] ${
                      stale ? 'font-semibold' : 'text-muted'
                    }`}
                    style={stale ? { color: 'var(--bay-gold)' } : undefined}
                  >
                    {lastTouchLabel(r.last_touch_at)}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function MpgPlaceholder() {
  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">MPG view — merchant services only.</p>
      <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
        Zoho CRM connects in an upcoming phase — MPG data will appear here.
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div
        className="num text-[30px] font-bold leading-none tracking-tight"
        style={accent ? { color: 'var(--bay)' } : undefined}
      >
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted">{label}</div>
    </div>
  )
}

// ---- Demo mode: the Phase 1 placeholder content, unchanged -----------------

const placeholderDeals = [
  { id: 1, biz: 'mpg', title: 'Bayou City Auto Repair', sub: 'Merchant services · est. $310/mo', stage: 'Discovery / Statement', date: 'Today' },
  { id: 2, biz: 'bay', title: 'Ramirez · $340K Purchase', sub: 'Conventional · ref: K. Pham', stage: 'Clear to Close', date: 'Feb 26' },
  { id: 3, biz: 'mpg', title: 'Lone Star BBQ Supply', sub: 'Displacement · est. $520/mo', stage: 'Analysis & Proposal', date: 'Feb 25' },
  { id: 4, biz: 'bay', title: 'Nguyen · $215K Refi', sub: 'Rate/term · ref: direct', stage: 'Processing', date: 'Feb 27' },
]

function DemoOverview() {
  const { biz, matches } = useBusiness()
  const deals = placeholderDeals.filter((d) => matches(d.biz))
  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">
        Demo mode — connect Supabase to see live pipeline data here.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <Kpi label="Active deals" value={deals.length} />
        <Kpi label="Pipeline value" value="—" />
        <Kpi label="Follow-ups due today" value="—" />
        <Kpi label="Closed this month" value="—" />
      </div>
      <div className="mt-5 rounded-card border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="grad-dual h-[7px] w-[7px] rounded-full" />
            Active Workbench
            <span className="num text-[11px] font-medium text-muted">
              {deals.length} / {placeholderDeals.length}
            </span>
          </div>
          <span className="text-xs text-dim">Placeholder rows — demo mode</span>
        </div>
        {deals.map((d) => (
          <div
            key={d.id}
            className="relative flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
          >
            <span
              className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
              style={{ background: d.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{d.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                <BizBadge biz={d.biz} />
                {d.sub}
              </div>
            </div>
            <span
              className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{
                background: d.biz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)',
                color: d.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)',
              }}
            >
              {d.stage}
            </span>
            <span
              className={`w-16 whitespace-nowrap text-right text-[11.5px] ${
                d.date === 'Today' ? 'font-semibold' : 'text-muted'
              }`}
              style={d.date === 'Today' ? { color: 'var(--bay-gold)' } : undefined}
            >
              {d.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
