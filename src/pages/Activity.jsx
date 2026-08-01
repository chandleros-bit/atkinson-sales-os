import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { TYPE_META, TYPE_CHIPS, filterByType, groupByDay, timeOfDay } from '../lib/activity'
import CrmLink from '../components/CrmLink'

const PER_PAGE = 150

const ACTIVITY = {
  bay: {
    label: 'BAYWAY',
    accent: 'bay',
    source: 'v_bayway_activity',
    copy: 'Bayway activity — calls, texts, emails, notes, and appointments from FollowUpBoss.',
    empty: 'No activity yet — connect the FollowUpBoss activity sync (see docs/phase-activity-fub-setup.md).',
    demoRows: [
      { id: 'd1', type: 'call', occurred_at: new Date(Date.now() - 2 * 3600000).toISOString(), contact_name: 'Marcus Ramirez', snippet: 'Left VM re: rate lock, retry PM', owner: 'You', crm_profile_url: '#' },
      { id: 'd2', type: 'text', occurred_at: new Date(Date.now() - 3 * 3600000).toISOString(), contact_name: 'Dana Whitfield', snippet: '“Got the paystubs, thanks!”', owner: 'You', crm_profile_url: '#' },
      { id: 'd3', type: 'email', occurred_at: new Date(Date.now() - 4 * 3600000).toISOString(), contact_name: 'Priya Nair', snippet: 'Sent pre-approval letter', owner: 'You', crm_profile_url: '#' },
      { id: 'd4', type: 'appointment', occurred_at: new Date(Date.now() - 26 * 3600000).toISOString(), contact_name: 'Kevin Osei', snippet: 'Signing @ Title Co.', owner: 'You', crm_profile_url: '#' },
    ],
  },
  mpg: {
    label: 'MPG',
    accent: 'mpg',
    source: 'v_mpg_activity',
    // Zoho has no listable text/email module, so the MPG feed is calls,
    // meetings, and notes (see zoho-activity.ts).
    copy: 'MPG activity — calls, meetings, and notes from Zoho CRM.',
    empty: 'No activity yet — connect the Zoho activity sync (see docs/phase-activity-zoho-setup.md).',
    demoRows: [
      { id: 'd1', type: 'call', occurred_at: new Date(Date.now() - 2 * 3600000).toISOString(), contact_name: 'Northline Retail', snippet: 'Owner call — walked through pricing', owner: 'You', crm_profile_url: '#' },
      { id: 'd2', type: 'note', occurred_at: new Date(Date.now() - 5 * 3600000).toISOString(), contact_name: 'Bayside Diner', snippet: 'Statement received — analyzing effective rate', owner: 'You', crm_profile_url: '#' },
      { id: 'd3', type: 'appointment', occurred_at: new Date(Date.now() - 27 * 3600000).toISOString(), contact_name: 'Craft Pita', snippet: 'Merchant demo — terminal + gateway', owner: 'You', crm_profile_url: '#' },
      { id: 'd4', type: 'call', occurred_at: new Date(Date.now() - 30 * 3600000).toISOString(), contact_name: 'Heights Auto', snippet: 'Left VM re: proposal follow-up', owner: 'You', crm_profile_url: '#' },
    ],
  },
}

// The 'call' tag takes the business accent (green Bayway / blue MPG) so the
// dominant activity type stays on-brand and the two palettes never mix on one
// page; other types keep their shared semantic hue from TYPE_META.
function TypeTag({ type, accent }) {
  const m =
    type === 'call'
      ? { label: 'Call', color: `var(--${accent})`, border: `var(--${accent}-line)` }
      : TYPE_META[type] || { label: type, color: 'var(--muted)', border: 'var(--line)' }
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
              typeFilter === c.key ? 'bg-hoverbg text-[color:var(--text)]' : 'text-muted hover:text-[color:var(--text)]'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading activity…</div>}

      {!loading && !error && sourceRows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          {config.empty}
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
                    <TypeTag type={r.type} accent={config.accent} />
                    <div className="num w-14 flex-none text-[12px] text-muted">{timeOfDay(r.occurred_at)}</div>
                    <div className="w-40 flex-none truncate text-[13px] font-semibold">
                      <CrmLink url={r.crm_profile_url}>{r.contact_name || '(unknown)'}</CrmLink>
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
            className="rounded-lg border border-line2 px-4 py-1.5 text-xs font-semibold text-muted hover:text-[color:var(--text)] disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  )
}
