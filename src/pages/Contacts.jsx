import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel } from '../lib/overview'
import { filterContacts, sortContacts, NURTURE } from '../lib/contacts'

const PER_PAGE = 50

function BizHeader({ biz, note }) {
  const isMpg = biz === 'mpg'
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[26px] font-bold tracking-tight">Contacts</h2>
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
  )
}

function stagePillStyle(stage) {
  if (stage === NURTURE) return { background: 'transparent', color: 'var(--dim)' }
  if (stage === 'Waiting on Docs') return { background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }
  return { background: 'var(--bay-soft)', color: 'var(--bay)' }
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'nurture', label: 'Nurture' },
]

const demoRows = [
  { id: 'd1', name: 'Ramirez · Purchase', email: null, phone: '(713) 555-0142', stage: 'Pre-Approved', last_touch_at: null },
  { id: 'd2', name: 'Nguyen · Refi', email: 'nguyen@example.com', phone: '(281) 555-0195', stage: NURTURE, last_touch_at: null },
]

export default function Contacts({ biz }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [sortKey, setSortKey] = useState('last_touch_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (isDemoMode || biz !== 'bay') return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('v_bayway_contacts')
        .select('id, name, email, phone, last_touch_at, stage')
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

  const sourceRows = isDemoMode ? demoRows : rows
  const filtered = useMemo(
    () => sortContacts(filterContacts(sourceRows, { query, stageFilter }), { key: sortKey, dir: sortDir }),
    [sourceRows, query, stageFilter, sortKey, sortDir],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const setSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'last_touch_at' ? 'desc' : 'asc')
    }
    setPage(1)
  }
  const onQuery = (v) => {
    setQuery(v)
    setPage(1)
  }
  const onFilter = (k) => {
    setStageFilter(k)
    setPage(1)
  }

  if (biz === 'mpg') {
    return (
      <div>
        <BizHeader biz="mpg" />
        <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          Zoho CRM connects in an upcoming phase — MPG contacts will appear here.
        </div>
      </div>
    )
  }

  const arrow = (key) => (key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  return (
    <div>
      <BizHeader
        biz="bay"
        note={
          !loading &&
          !error && (
            <span className="num text-[12px] text-muted">
              {sourceRows.length} contacts · showing {filtered.length}
            </span>
          )
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name, email, or phone…"
          className="w-64 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[13px] outline-none placeholder:text-dim focus:border-line2"
        />
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilter(f.key)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                stageFilter === f.key ? 'bg-hoverbg text-white' : 'text-muted hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading contacts…</div>}

      {!loading && !error && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-panel">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
            <button onClick={() => setSort('name')} className="flex-1 text-left hover:text-white">
              Name{arrow('name')}
            </button>
            <button onClick={() => setSort('stage')} className="w-32 text-left hover:text-white">
              Stage{arrow('stage')}
            </button>
            <div className="w-40">Contact</div>
            <button onClick={() => setSort('last_touch_at')} className="w-24 text-right hover:text-white">
              Last touch{arrow('last_touch_at')}
            </button>
          </div>

          {pageRows.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted">No contacts match.</div>
          )}

          {pageRows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hoverbg">
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.name || '(no name)'}</div>
              <div className="w-32">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={stagePillStyle(r.stage)}>
                  {r.stage}
                </span>
              </div>
              <div className="w-40 truncate text-[11.5px] text-muted">
                {r.phone || r.email || 'no contact info'}
              </div>
              <div className="w-24 text-right text-[11.5px] text-muted">{lastTouchLabel(r.last_touch_at)}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && pageCount > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-muted">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="num">
            Page {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
