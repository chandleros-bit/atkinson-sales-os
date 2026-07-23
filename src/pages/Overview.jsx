import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import BizBadge from '../components/BizBadge'
import CalendarRail from '../components/CalendarRail'
import MyTasks from '../components/MyTasks'
import CrmLink from '../components/CrmLink'
import { crmProfileUrl } from '../lib/crm'
import {
  buildKpis,
  buildCombinedKpis,
  deriveAlert,
  sortByAttention,
  lastTouchLabel,
  daysSince,
  isHot,
  isMpgOpen,
  STALE_TOUCH_DAYS,
} from '../lib/overview'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function stagePillStyle(stage, biz) {
  if (biz === 'mpg') return { background: 'var(--mpg-soft)', color: 'var(--mpg)' }
  if (stage === 'Waiting on Docs') {
    return { background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }
  }
  return { background: 'var(--bay-soft)', color: 'var(--bay)' }
}

// ---- Dispatcher: one view per business filter --------------------------------

export default function Overview() {
  const { biz } = useBusiness()
  if (isDemoMode) return <DemoOverview />
  if (biz === 'mpg') return <MpgOverview />
  if (biz === 'bay') return <BayOverview />
  return <AllOverview />
}

// ---- Shared building blocks --------------------------------------------------

function PageHeader({ subtitle }) {
  return (
    <>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </>
  )
}

function ErrorNote({ error }) {
  if (!error) return null
  return (
    <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
      {error}
    </div>
  )
}

function AlertBanner({ alert }) {
  if (!alert) return null
  return (
    <div
      className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
        alert.level === 'red'
          ? 'border-red-900/60 bg-red-950/40 text-red-300'
          : 'border-[rgba(232,180,95,.4)] bg-[rgba(232,180,95,.1)] text-[#e8b45f]'
      }`}
    >
      {alert.text}
    </div>
  )
}

function Kpi({ label, value, accent, mpg }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div
        className="num text-[30px] font-bold leading-none tracking-tight"
        style={accent ? { color: mpg ? 'var(--mpg)' : 'var(--bay)' } : undefined}
      >
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted">{label}</div>
    </div>
  )
}

// Combined-view KPI: a total with the MPG / Bayway split below (mockup .ksplit).
function SplitKpi({ label, split, totalColor }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div
        className="num text-[30px] font-bold leading-none tracking-tight"
        style={totalColor ? { color: totalColor } : undefined}
      >
        {split.total}
      </div>
      <div className="mt-1.5 text-xs text-muted">{label}</div>
      <div className="mt-3 flex gap-4 border-t border-line pt-2.5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="h-[7px] w-[7px] rounded-sm" style={{ background: 'var(--mpg)' }} />
          MPG <b className="num font-semibold text-white">{split.mpg}</b>
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="h-[7px] w-[7px] rounded-sm" style={{ background: 'var(--bay)' }} />
          Bayway <b className="num font-semibold text-white">{split.bay}</b>
        </span>
      </div>
    </div>
  )
}

// One attention row. Renders per its own business_id, so bay + mpg rows can be
// mixed in the combined list: MPG is merchant-first (company), Bayway person-first.
function AttentionRow({ r }) {
  const isMpg = r.business_id === 'mpg'
  const d = daysSince(r.last_touch_at)
  const stale = d === null || d >= STALE_TOUCH_DAYS
  const headline = (isMpg ? r.company || r.name : r.name) || '(no name)'
  const sub = (isMpg ? r.name || r.phone || r.email : r.phone || r.email) || 'no contact info'
  return (
    <div className="relative flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg">
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: isMpg ? 'var(--mpg)' : 'var(--bay)' }}
      />
      <div className="min-w-0 flex-1">
        <CrmLink url={r.crm_profile_url} className="block truncate text-[13.5px] font-semibold">
          {headline}
        </CrmLink>
        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
          <BizBadge biz={r.business_id} />
          {sub}
        </div>
      </div>
      <span
        className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
        style={stagePillStyle(r.stage, r.business_id)}
      >
        {r.stage || '—'}
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
}

// rows must already be sorted and each tagged with business_id.
function AttentionCard({ rows, dotClass, dotStyle, empty }) {
  return (
    <div className="mt-5 rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-[7px] w-[7px] rounded-full ${dotClass || ''}`} style={dotStyle} />
          Needs Attention
          <span className="num text-[11px] font-medium text-muted">{rows.length}</span>
        </div>
        <span className="text-xs text-dim">Sorted by longest since last touch</span>
      </div>
      {rows.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-muted">{empty}</div>
      )}
      {rows.map((r) => (
        <AttentionRow key={`${r.business_id}-${r.id}`} r={r} />
      ))}
    </div>
  )
}

// ---- Combined "All" command center ------------------------------------------

function AllOverview() {
  const [bayRows, setBayRows] = useState([])
  const [bayHotRows, setBayHotRows] = useState([])
  const [mpgRows, setMpgRows] = useState([])
  const [bayContacts, setBayContacts] = useState(0)
  const [mpgContacts, setMpgContacts] = useState(0)
  const [latestSync, setLatestSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [bayPipe, bayTagged, mpgLeads, bayCount, mpgCount, sync] = await Promise.all([
          supabase
            .from('v_active_pipeline')
            .select('id, business_id, name, email, phone, last_touch_at, stage')
            .eq('business_id', 'bay'),
          supabase
            .from('contacts')
            .select('id, name, email, phone, last_touch_at, external_id, tags:raw->tags')
            .eq('business_id', 'bay'),
          supabase
            .from('v_mpg_contacts')
            .select('id, name, company, email, phone, last_touch_at, stage, crm_profile_url'),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay'),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'mpg'),
          supabase
            .from('sync_log')
            .select('ran_at, status, message')
            .eq('source', 'fub')
            .order('ran_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (!alive) return
        const err =
          bayPipe.error || bayTagged.error || mpgLeads.error || bayCount.error || mpgCount.error || sync.error
        if (err) {
          setError(err.message)
          return
        }
        const bay = bayPipe.data || []
        setBayRows(bay)
        setBayHotRows(buildBayHotRows(bayTagged.data, bay))
        setMpgRows((mpgLeads.data || []).map((r) => ({ ...r, business_id: 'mpg' })))
        setBayContacts(bayCount.count || 0)
        setMpgContacts(mpgCount.count || 0)
        setLatestSync(sync.data)
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const kpis = buildCombinedKpis(bayRows, mpgRows, bayContacts, mpgContacts)
  const mpgOpen = mpgRows.filter((r) => isMpgOpen(r.stage))
  const attention = { mpg: mpgOpen.length, bay: bayHotRows.length, total: mpgOpen.length + bayHotRows.length }
  const merged = sortByAttention([...bayHotRows, ...mpgOpen])
  const alert = !loading && !error ? deriveAlert({ latestSync, rows: bayRows }) : null

  return (
    <div>
      <PageHeader subtitle="Here is what is happening across MPG and Bayway today." />
      <ErrorNote error={error} />

      {loading && <div className="mt-6 text-sm text-muted">Loading pipelines…</div>}

      {!loading && !error && (
        <>
          <AlertBanner alert={alert} />

          <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <SplitKpi label="In pipeline" split={kpis.pipeline} />
            <SplitKpi
              label="Needs attention"
              split={attention}
              totalColor={attention.total > 0 ? 'var(--bay-gold)' : undefined}
            />
            <SplitKpi label="Contacts" split={kpis.contacts} />
            <SplitKpi label="In nurture" split={kpis.nurture} />
          </div>

          <MyTasks />
          <AttentionCard
            rows={merged}
            dotClass="grad-dual"
            empty="No HOT Bayway or open MPG contacts right now."
          />
          <CalendarRail />
        </>
      )}
    </div>
  )
}

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

// ---- Bayway view (mortgage only) --------------------------------------------

function BayOverview() {
  const [rows, setRows] = useState([])
  const [hotRows, setHotRows] = useState([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [latestSync, setLatestSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [pipeline, tagged, contactCount, sync] = await Promise.all([
          supabase
            .from('v_active_pipeline')
            .select('id, business_id, name, email, phone, last_touch_at, stage')
            .eq('business_id', 'bay'),
          supabase
            .from('contacts')
            .select('id, name, email, phone, last_touch_at, external_id, tags:raw->tags')
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
        if (!alive) return
        const err = pipeline.error || tagged.error || contactCount.error || sync.error
        if (err) {
          setError(err.message)
          return
        }
        const pipe = pipeline.data || []
        setRows(pipe)
        setHotRows(buildBayHotRows(tagged.data, pipe))
        setTotalContacts(contactCount.count || 0)
        setLatestSync(sync.data)
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const kpis = buildKpis(rows, totalContacts)
  const alert = !loading && !error ? deriveAlert({ latestSync, rows }) : null
  const workbench = sortByAttention(hotRows)

  return (
    <div>
      <PageHeader subtitle="Bayway view — mortgage only." />
      <ErrorNote error={error} />

      {loading && <div className="mt-6 text-sm text-muted">Loading pipeline…</div>}

      {!loading && !error && (
        <>
          <AlertBanner alert={alert} />

          <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <Kpi label="Active loans" value={kpis.activeLoans} />
            {kpis.stageCards.map((c) => (
              <Kpi key={c.label} label={c.label} value={c.count} accent />
            ))}
            <Kpi label="New leads" value={kpis.newLeads} />
          </div>
          <p className="mt-2.5 text-[11.5px] text-dim">
            <span className="num font-semibold text-muted">{kpis.nurture}</span> in nurture
          </p>

          <MyTasks />
          <AttentionCard
            rows={workbench}
            dotStyle={{ background: 'var(--bay)' }}
            empty="No HOT-tagged contacts — tag a lead HOT in FollowUpBoss."
          />
          <CalendarRail />
        </>
      )}
    </div>
  )
}

// ---- MPG view — merchant services, sourced from Zoho leads (v_mpg_contacts) --
// Thin by design: the MPG book is 3 open leads and 0 deals today, so the
// pipeline lives on leads. Merchant-first: the company is the opportunity.

function MpgOverview() {
  const [leads, setLeads] = useState([])
  const [deals, setDeals] = useState(0)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [leadRes, dealRes] = await Promise.all([
          supabase
            .from('v_mpg_contacts')
            .select('id, name, company, email, phone, last_touch_at, stage, crm_profile_url'),
          supabase
            .from('deals')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', 'mpg'),
        ])
        if (!alive) return
        const err = leadRes.error || dealRes.error
        if (err) {
          setError(err.message)
          return
        }
        setLeads((leadRes.data || []).map((r) => ({ ...r, business_id: 'mpg' })))
        setDeals(dealRes.count || 0)
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const stageCounts = [...leads.reduce((m, l) => {
    const s = l.stage || '—'
    return m.set(s, (m.get(s) || 0) + 1)
  }, new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const workbench = sortByAttention(leads.filter((l) => isMpgOpen(l.stage)))

  return (
    <div>
      <PageHeader subtitle="MPG view — merchant services only." />
      <ErrorNote error={error} />

      {loading && <div className="mt-6 text-sm text-muted">Loading MPG leads…</div>}

      {!loading && !error && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <Kpi label="Leads" value={leads.length} mpg />
            {stageCounts.slice(0, 2).map(([label, count]) => (
              <Kpi key={label} label={label} value={count} mpg accent />
            ))}
            <Kpi label="Open deals" value={deals} />
          </div>
          <p className="mt-2.5 text-[11.5px] text-dim">
            MPG pipeline is lead-stage today — deals appear here once opened in Zoho.
          </p>

          <MyTasks />
          <AttentionCard
            rows={workbench}
            dotStyle={{ background: 'var(--mpg)' }}
            empty="No open MPG leads — set a lead to Open in Zoho CRM."
          />
          <CalendarRail />
        </>
      )}
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
  const { matches } = useBusiness()
  const deals = placeholderDeals.filter((d) => matches(d.biz))
  return (
    <div>
      <PageHeader subtitle="Demo mode — connect Supabase to see live pipeline data here." />
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
      <CalendarRail />
    </div>
  )
}
