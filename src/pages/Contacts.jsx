import { Fragment, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel } from '../lib/overview'
import { filterContacts, sortContacts, NURTURE } from '../lib/contacts'

const PER_PAGE = 50

function bayStagePill(stage) {
  if (stage === NURTURE) return { background: 'transparent', color: 'var(--dim)' }
  if (stage === 'Waiting on Docs') return { background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }
  return { background: 'var(--bay-soft)', color: 'var(--bay)' }
}

function mpgStagePill(stage) {
  if (!stage || stage === '—') return { background: 'transparent', color: 'var(--dim)' }
  return { background: 'var(--mpg-soft)', color: 'var(--mpg)' }
}

const BAY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'nurture', label: 'Nurture' },
]

const CONFIGS = {
  bay: {
    label: 'BAYWAY',
    accent: 'bay',
    source: 'v_bayway_contacts',
    columns: ['name', 'stage', 'contact', 'last_touch'],
    stageHeader: 'Stage',
    filters: BAY_FILTERS,
    stagePill: bayStagePill,
    demoRows: [
      { id: 'd1', name: 'Ramirez · Purchase', email: null, phone: '(713) 555-0142', stage: 'Pre-Approved', last_touch_at: null, crm_profile_url: '#' },
      { id: 'd2', name: 'Nguyen · Refi', email: 'nguyen@example.com', phone: '(281) 555-0195', stage: NURTURE, last_touch_at: null, crm_profile_url: '#' },
    ],
  },
  mpg: {
    label: 'MPG',
    accent: 'mpg',
    source: 'v_mpg_contacts',
    columns: ['name', 'company', 'stage', 'contact', 'last_touch'],
    stageHeader: 'Status',
    filters: [],
    stagePill: mpgStagePill,
    demoRows: [
      { id: 'd1', name: 'Chef Rasi', company: 'Craft Pita', email: null, phone: '(832) 804-9056', stage: 'Open', last_touch_at: null, crm_profile_url: '#' },
      { id: 'd2', name: 'Owner ?', company: 'Barnaby’s Cafe', email: 'x@example.com', phone: '(832) 831-8296', stage: 'Open', last_touch_at: null, crm_profile_url: '#' },
    ],
  },
}

// Column registry — header thClass and cell width classes are kept in sync.
const COLUMNS = {
  name: {
    header: () => 'Name',
    thClass: 'flex-1 text-left',
    sortKey: 'name',
    cell: (r) => (
      <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
        {r.crm_profile_url ? (
          <a
            href={r.crm_profile_url}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
            title="Open in CRM"
          >
            {r.name || '(no name)'}
          </a>
        ) : (
          r.name || '(no name)'
        )}
      </div>
    ),
  },
  company: {
    header: () => 'Company',
    thClass: 'w-40 text-left',
    sortKey: 'company',
    cell: (r) => <div className="w-40 truncate text-[12.5px] text-muted">{r.company || '—'}</div>,
  },
  stage: {
    header: (config) => config.stageHeader,
    thClass: 'w-32 text-left',
    sortKey: 'stage',
    cell: (r, config) => (
      <div className="w-32">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={config.stagePill(r.stage)}>
          {r.stage || '—'}
        </span>
      </div>
    ),
  },
  contact: {
    header: () => 'Contact',
    thClass: 'w-40 text-left',
    sortKey: null,
    cell: (r) => (
      <div className="w-40 truncate text-[11.5px] text-muted">{r.phone || r.email || 'no contact info'}</div>
    ),
  },
  last_touch: {
    header: () => 'Last touch',
    thClass: 'w-24 text-right',
    sortKey: 'last_touch_at',
    cell: (r) => (
      <div className="w-24 text-right text-[11.5px] text-muted">{lastTouchLabel(r.last_touch_at)}</div>
    ),
  },
}

function BizHeader({ config, note }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[26px] font-bold tracking-tight">Contacts</h2>
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
        style={{ color: `var(--${config.accent})`, background: `var(--${config.accent}-soft)` }}
      >
        {config.label}
      </span>
      {note}
    </div>
  )
}

export default function Contacts({ biz }) {
  const config = CONFIGS[biz] || CONFIGS.bay

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [sortKey, setSortKey] = useState('last_touch_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.from(config.source).select('*')
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
  }, [config.source])

  useEffect(() => {
    load()
  }, [load])

  const sourceRows = isDemoMode ? config.demoRows : rows
  const filtered = useMemo(
    () => sortContacts(filterContacts(sourceRows, { query, stageFilter }), { key: sortKey, dir: sortDir }),
    [sourceRows, query, stageFilter, sortKey, sortDir],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const setSort = (key) => {
    if (!key) return
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

  const arrow = (key) => (key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  return (
    <div>
      <BizHeader
        config={config}
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
          placeholder="Search name, company, email, or phone…"
          className="w-64 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[13px] outline-none placeholder:text-dim focus:border-line2"
        />
        {config.filters.length > 0 && (
          <div className="flex gap-1">
            {config.filters.map((f) => (
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
        )}
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
            {config.columns.map((colKey) => {
              const col = COLUMNS[colKey]
              return col.sortKey ? (
                <button
                  key={colKey}
                  onClick={() => setSort(col.sortKey)}
                  className={`${col.thClass} hover:text-white`}
                >
                  {col.header(config)}
                  {arrow(col.sortKey)}
                </button>
              ) : (
                <div key={colKey} className={col.thClass}>
                  {col.header(config)}
                </div>
              )
            })}
          </div>

          {pageRows.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted">No contacts match.</div>
          )}

          {pageRows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hoverbg"
            >
              {config.columns.map((colKey) => (
                <Fragment key={colKey}>{COLUMNS[colKey].cell(r, config)}</Fragment>
              ))}
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
