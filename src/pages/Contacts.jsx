import { Fragment, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { lastTouchLabel } from '../lib/overview'
import { filterContacts, sortContacts, NURTURE } from '../lib/contacts'
import { formatPhone, telHref } from '../lib/phone'
import PersonLink from '../components/PersonLink'
import PageHeader from '../components/PageHeader'
import { ScheduleButton } from '../components/ScheduleEvent'

const PER_PAGE = 50

// Phones: one card per contact (name and last touch, then company · stage,
// then a tappable phone) instead of a five-column table.
function MobileContactRow({ r, config }) {
  const name = r.name || '(no name)'
  return (
    <div data-contact-row className="border-b border-line px-4 py-3 last:border-b-0 sm:hidden">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-[14px] font-semibold">
          <PersonLink id={r.id} url={r.crm_profile_url}>
            {name}
          </PersonLink>
        </div>
        <div className="flex flex-none items-center gap-1 text-[11.5px] text-muted">
          {lastTouchLabel(r.last_touch_at)}
          <ScheduleButton variant="icon" businessId={config.biz} contactId={r.id} contactName={r.name} />
        </div>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {r.company && <span className="min-w-0 truncate text-[12.5px] text-muted">{r.company}</span>}
        {r.stage && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={config.stagePill(r.stage)}>
            {r.stage}
          </span>
        )}
      </div>
      {(r.phone || r.email) && (
        <div className="mt-1 truncate text-[12.5px]">
          {r.phone ? (
            <a href={telHref(r.phone)} className="font-semibold" style={{ color: 'var(--text)' }}>
              {formatPhone(r.phone)}
            </a>
          ) : (
            <span className="text-muted">{r.email}</span>
          )}
        </div>
      )}
    </div>
  )
}

function bayStagePill(stage) {
  if (stage === NURTURE) return { background: 'transparent', color: 'var(--dim)' }
  if (stage === 'Application Received') return { background: 'var(--warn-bg)', color: 'var(--warn-ink)' }
  return { background: 'var(--bay-soft)', color: 'var(--bay-ink)' }
}

function mpgStagePill(stage) {
  if (!stage || stage === '—') return { background: 'transparent', color: 'var(--dim)' }
  return { background: 'var(--mpg-soft)', color: 'var(--mpg-ink)' }
}

const BAY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'nurture', label: 'Nurture' },
]

const CONFIGS = {
  bay: {
    label: 'Bayway · FollowUpBoss',
    biz: 'bay',
    accent: 'bay',
    source: 'v_bayway_contacts',
    columns: ['name', 'stage', 'contact', 'last_touch', 'schedule'],
    stageHeader: 'Stage',
    filters: BAY_FILTERS,
    stagePill: bayStagePill,
    demoRows: [
      { id: 'd1', name: 'Ramirez · Purchase', email: null, phone: '(713) 555-0142', stage: 'Application/Estimate Sent', last_touch_at: null, crm_profile_url: '#' },
      { id: 'd2', name: 'Nguyen · Refi', email: 'nguyen@example.com', phone: '(281) 555-0195', stage: NURTURE, last_touch_at: null, crm_profile_url: '#' },
    ],
  },
  mpg: {
    label: 'MPG · Zoho',
    biz: 'mpg',
    accent: 'mpg',
    source: 'v_mpg_contacts',
    columns: ['name', 'company', 'stage', 'contact', 'last_touch', 'schedule'],
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
        <PersonLink id={r.id} url={r.crm_profile_url}>
          {r.name || '(no name)'}
        </PersonLink>
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
  // Schedule a call or meeting with this contact (ScheduleEvent).
  schedule: {
    header: () => '',
    thClass: 'w-8',
    sortKey: null,
    cell: (r, config) => (
      <div className="flex w-8 justify-end">
        <ScheduleButton variant="icon" businessId={config.biz} contactId={r.id} contactName={r.name} />
      </div>
    ),
  },
}

function BizHeader({ config, note }) {
  return (
    <PageHeader eyebrow={config.label} eyebrowColor={`var(--${config.accent}-ink)`} title="Contacts" note={note} />
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
      const { data, error: err } = await fetchAllSettled(() =>
        supabase.from(config.source).select('*').order('id'),
      )
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
          className="min-h-[40px] w-full rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[13px] outline-none sm:min-h-0 sm:w-64 placeholder:text-dim focus:border-line2"
        />
        {config.filters.length > 0 && (
          <div className="flex gap-1">
            {config.filters.map((f) => (
              <button
                key={f.key}
                onClick={() => onFilter(f.key)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold sm:min-h-0 sm:px-2.5 ${
                  stageFilter === f.key ? 'bg-hoverbg text-[color:var(--text)]' : 'text-muted hover:text-[color:var(--text)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading contacts…</div>}

      {!loading && !error && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-panel">
          <div className="hidden items-center gap-3 border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-dim sm:flex">
            {config.columns.map((colKey) => {
              const col = COLUMNS[colKey]
              return col.sortKey ? (
                <button
                  key={colKey}
                  onClick={() => setSort(col.sortKey)}
                  className={`${col.thClass} hover:text-[color:var(--text)]`}
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
            <Fragment key={r.id}>
              <div className="hidden items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hoverbg sm:flex">
                {config.columns.map((colKey) => (
                  <Fragment key={colKey}>{COLUMNS[colKey].cell(r, config)}</Fragment>
                ))}
              </div>
              <MobileContactRow r={r} config={config} />
            </Fragment>
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
