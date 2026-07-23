import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel, isHot } from '../lib/overview'
import { TIERS, tierMeta, scoreBarPct, groupByTier } from '../lib/priorityLeads'

const COLUMNS =
  'id, name, owner, score, tier, last_activity_at, last_activity_type, ai_note, tags, fub_profile_url'

function Header({ note }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[26px] font-bold tracking-tight">Priority Leads</h2>
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
        style={{ color: 'var(--bay-ink)', background: 'var(--bay-soft)' }}
      >
        BAYWAY
      </span>
      {note}
    </div>
  )
}

function Tabs({ groups, active, onSelect }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {TIERS.map((t) => {
        const on = t.key === active
        const count = groups[t.key]?.length || 0
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              on ? 'text-[color:var(--text)]' : 'text-muted hover:text-[color:var(--text)]'
            }`}
            style={{
              borderColor: on ? t.color : 'var(--line)',
              background: on ? t.soft : 'transparent',
            }}
          >
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: t.color }} />
            {t.label}
            <span className="num text-[11px] text-muted">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

function ScoreBar({ score, color }) {
  const pct = scoreBarPct(score)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-panel2">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="num w-6 text-right text-[11px] text-muted">{pct}</span>
    </div>
  )
}

function Row({ r }) {
  const [open, setOpen] = useState(false)
  const meta = tierMeta(r.tier)
  const lastLabel = lastTouchLabel(r.last_activity_at)
  const typeLabel = r.last_activity_at && r.last_activity_type ? ` · ${r.last_activity_type}` : ''
  const hot = isHot(r.tags)

  return (
    <div className="relative rounded-lg border border-line bg-panel2 px-3.5 py-3 pl-4">
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: meta.color }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {r.fub_profile_url ? (
              <a
                href={r.fub_profile_url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[13.5px] font-semibold hover:underline"
              >
                {r.name || '(no name)'}
              </a>
            ) : (
              <span className="truncate text-[13.5px] font-semibold">{r.name || '(no name)'}</span>
            )}
            <span
              className="flex-none rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide"
              style={{ color: meta.color, background: meta.soft }}
            >
              {meta.label.toUpperCase()}
            </span>
            {hot && (
              <span
                className="flex-none rounded px-1 py-0.5 text-[9px] font-bold tracking-wide"
                style={{ color: '#ff5c5c', background: 'rgba(255,92,92,0.14)' }}
                title="Tagged HOT in FollowUpBoss"
              >
                HOT TAG
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11.5px] text-muted">
            <span>
              {lastLabel}
              {typeLabel}
            </span>
            {r.owner && <span className="text-dim">· {r.owner}</span>}
          </div>
        </div>
        <div className="flex-none pt-0.5">
          <ScoreBar score={r.score} color={meta.color} />
        </div>
      </div>

      {r.ai_note && (
        <div className="mt-2 text-[11.5px] text-muted">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-dim hover:text-[color:var(--text)]"
            aria-expanded={open}
          >
            {open ? 'Hide note' : 'AI note · see more'}
          </button>
          {open && <p className="mt-1 leading-snug text-muted">{r.ai_note}</p>}
        </div>
      )}
    </div>
  )
}

const demoRows = [
  { id: 'p1', name: 'Ramirez · Purchase', owner: 'Chandler', score: 92, tier: 'hot', last_activity_at: new Date(Date.now() - 86400000).toISOString(), last_activity_type: 'call', tags: ['HOT'], ai_note: null, fub_profile_url: '#' },
  { id: 'p2', name: 'Nguyen · Refi', owner: 'Chandler', score: 74, tier: 'hot', last_activity_at: new Date(Date.now() - 2 * 86400000).toISOString(), last_activity_type: 'email', tags: [], ai_note: null, fub_profile_url: '#' },
  { id: 'p3', name: 'Okafor · Purchase', owner: 'Chandler', score: 48, tier: 'warm', last_activity_at: new Date(Date.now() - 20 * 86400000).toISOString(), last_activity_type: 'note', tags: [], ai_note: null, fub_profile_url: '#' },
  { id: 'p4', name: 'Delgado · Refi', owner: 'Chandler', score: 55, tier: 'active', last_activity_at: new Date(Date.now() - 9 * 86400000).toISOString(), last_activity_type: 'appointment', tags: [], ai_note: null, fub_profile_url: '#' },
  { id: 'p5', name: 'Whitfield · Purchase', owner: 'Chandler', score: 0, tier: 'never_contacted', last_activity_at: null, last_activity_type: null, tags: [], ai_note: null, fub_profile_url: '#' },
]

export default function PriorityLeads() {
  const [rows, setRows] = useState(isDemoMode ? demoRows : [])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  const [active, setActive] = useState('hot')

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('v_priority_leads')
        .select(COLUMNS)
        .eq('business_id', 'bay')
      if (err) {
        setError(err.message)
        return
      }
      setRows(data || [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => groupByTier(rows), [rows])
  const current = groups[active] || []

  return (
    <div>
      <Header
        note={
          !loading &&
          !error && <span className="num text-[12px] text-muted">{rows.length} scored</span>
        }
      />

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <Tabs groups={groups} active={active} onSelect={setActive} />

      {loading && <div className="mt-6 text-sm text-muted">Loading priority leads…</div>}

      {!loading && !error && current.length === 0 && (
        <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No {tierMeta(active).label.toLowerCase()} leads right now.
        </div>
      )}

      {!loading && !error && current.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {current.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  )
}
