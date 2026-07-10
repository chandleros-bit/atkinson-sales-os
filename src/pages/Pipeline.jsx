import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel, daysSince, STALE_TOUCH_DAYS } from '../lib/overview'
import { buildColumns } from '../lib/pipeline'

function BizHeader({ biz, note }) {
  const isMpg = biz === 'mpg'
  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Pipeline</h2>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
          style={{
            color: isMpg ? 'var(--mpg)' : 'var(--bay)',
            background: isMpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
          }}
        >
          {isMpg ? 'MPG' : 'BAYWAY'}
        </span>
        {note}
      </div>
    </div>
  )
}

function Card({ r, lost }) {
  const d = daysSince(r.last_touch_at)
  const stale = d === null || d >= STALE_TOUCH_DAYS
  return (
    <div className="relative rounded-lg border border-line bg-panel2 px-3 py-2.5 pl-3.5">
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: lost ? 'var(--dim)' : 'var(--bay)' }}
      />
      <div className="truncate text-[13px] font-semibold">{r.name || '(no name)'}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted">
        {r.phone || r.email || 'no contact info'}
      </div>
      <div
        className={`mt-1 text-[11px] ${stale ? 'font-semibold' : 'text-dim'}`}
        style={stale ? { color: 'var(--bay-gold)' } : undefined}
      >
        {lastTouchLabel(r.last_touch_at)}
      </div>
    </div>
  )
}

function Column({ col }) {
  return (
    <div className="w-[280px] flex-none rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className={`text-[12.5px] font-semibold ${col.isLost ? 'text-dim' : ''}`}>
          {col.stage}
        </span>
        <span className="num text-[11px] text-muted">{col.cards.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2.5">
        {col.cards.map((r) => (
          <Card key={r.id} r={r} lost={col.isLost} />
        ))}
      </div>
    </div>
  )
}

function Board({ columns }) {
  return (
    <div className="mt-5 flex gap-3.5 overflow-x-auto pb-2">
      {columns.map((col) => (
        <Column key={col.stage} col={col} />
      ))}
    </div>
  )
}

const demoRows = [
  { id: 'd1', stage: 'Waiting on Docs', name: 'Ramirez · Purchase', phone: '(713) 555-0142', last_touch_at: null },
  { id: 'd2', stage: 'Pre-Approved', name: 'Nguyen · Refi', phone: '(281) 555-0195', last_touch_at: null },
  { id: 'd3', stage: 'Pre-Approved', name: 'Okafor · Purchase', phone: '(832) 555-0110', last_touch_at: null },
]

export default function Pipeline({ biz }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode || biz !== 'bay') return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('v_active_pipeline')
        .select('id, business_id, name, email, phone, last_touch_at, stage')
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
  }, [biz])

  useEffect(() => {
    load()
  }, [load])

  if (biz === 'mpg') {
    return (
      <div>
        <BizHeader biz="mpg" />
        <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          Zoho CRM connects in an upcoming phase — the MPG pipeline will appear here.
        </div>
      </div>
    )
  }

  if (isDemoMode) {
    return (
      <div>
        <BizHeader biz="bay" note={<span className="text-xs text-dim">demo</span>} />
        <Board columns={buildColumns(demoRows)} />
      </div>
    )
  }

  const columns = buildColumns(rows)

  return (
    <div>
      <BizHeader
        biz="bay"
        note={!loading && !error && <span className="num text-[12px] text-muted">{rows.length} active</span>}
      />

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading pipeline…</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No active loans — add stages in FollowUpBoss.
        </div>
      )}

      {!loading && !error && rows.length > 0 && <Board columns={columns} />}
    </div>
  )
}
