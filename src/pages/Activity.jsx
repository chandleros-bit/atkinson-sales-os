import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { TYPE_META, TYPE_CHIPS, filterByType, groupByDay, timeOfDay } from '../lib/activity'

const PER_PAGE = 150

// Config-driven so MPG can be added later once a Zoho activity sync exists.
const ACTIVITY = {
  bay: {
    label: 'BAYWAY',
    accent: 'bay',
    source: 'v_bayway_activity',
    copy: 'Bayway activity — calls, texts, emails, notes, and appointments from FollowUpBoss.',
    demoRows: [
      { id: 'd1', type: 'call', occurred_at: new Date(Date.now() - 2 * 3600000).toISOString(), contact_name: 'Marcus Ramirez', snippet: 'Left VM re: rate lock, retry PM', owner: 'You' },
      { id: 'd2', type: 'text', occurred_at: new Date(Date.now() - 3 * 3600000).toISOString(), contact_name: 'Dana Whitfield', snippet: '“Got the paystubs, thanks!”', owner: 'You' },
      { id: 'd3', type: 'email', occurred_at: new Date(Date.now() - 4 * 3600000).toISOString(), contact_name: 'Priya Nair', snippet: 'Sent pre-approval letter', owner: 'You' },
      { id: 'd4', type: 'appointment', occurred_at: new Date(Date.now() - 26 * 3600000).toISOString(), contact_name: 'Kevin Osei', snippet: 'Signing @ Title Co.', owner: 'You' },
    ],
  },
}

function TypeTag({ type }) {
  const m = TYPE_META[type] || { label: type, color: 'var(--muted)', border: 'var(--line)' }
  return (
    <span
      className="flex-none rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: m.color, border: `1px solid ${m.border}`, width: 46 }}
    >
      {m.label}
    </span>
  )
}

export default function Activity({ biz }) {
  const config = ACTIVITY[biz] || ACTIVITY.bay

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')

  const fetchPage = useCallback(
    async (offset) => {
      const { data, error: err } = await supabase
        .from(config.source)
        .select('*')
        .order('occurred_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(offset, offset + PER_PAGE - 1)
      if (err) throw new Error(err.message)
      return data || []
    },
    [config.source],
  )

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchPage(0)
      setRows(page)
      setHasMore(page.length === PER_PAGE)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [fetchPage])

  useEffect(() => {
    load()
  }, [load])

  const loadOlder = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(rows.length)
      setRows((prev) => [...prev, ...page])
      setHasMore(page.length === PER_PAGE)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  const sourceRows = isDemoMode ? config.demoRows : rows
  const groups = useMemo(() => groupByDay(filterByType(sourceRows, typeFilter)), [sourceRows, typeFilter])
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Activity</h2>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
          style={{ color: `var(--${config.accent})`, background: `var(--${config.accent}-soft)` }}
        >
          {config.label}
        </span>
        {!loading && !error && <span className="num text-[12px] text-muted">{total} shown</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{config.copy}</p>

      <div className="mt-4 flex flex-wrap gap-1">
        {TYPE_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setTypeFilter(c.key)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              typeFilter === c.key ? 'bg-hoverbg text-white' : 'text-muted hover:text-white'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading activity…</div>}

      {!loading && !error && sourceRows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No activity yet — connect the FollowUpBoss activity sync (see docs/phase-activity-fub-setup.md).
        </div>
      )}

      {!loading && sourceRows.length > 0 && total === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          {typeFilter === 'all'
            ? 'No activity in the loaded range.'
            : `No ${TYPE_CHIPS.find((c) => c.key === typeFilter)?.label.toLowerCase()} in the loaded range.`}
        </div>
      )}

      {!loading && total > 0 && (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.dayKey}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">{g.label}</div>
              <div className="overflow-hidden rounded-card border border-line bg-panel">
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                  >
                    <TypeTag type={r.type} />
                    <div className="num w-14 flex-none text-[12px] text-muted">{timeOfDay(r.occurred_at)}</div>
                    <div className="w-40 flex-none truncate text-[13px] font-semibold">
                      {r.contact_name || '(unknown)'}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{r.snippet || '—'}</div>
                    {r.owner && (
                      <div className="w-28 flex-none truncate text-right text-[11px] text-dim">{r.owner}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !isDemoMode && hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadOlder}
            disabled={loadingMore}
            className="rounded-lg border border-line2 px-4 py-1.5 text-xs font-semibold text-muted hover:text-white disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  )
}
