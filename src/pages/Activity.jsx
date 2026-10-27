import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { TYPE_META, TYPE_CHIPS, filterByType, groupByDay, timeOfDay, mergeFeeds } from '../lib/activity'
import { useBusiness } from '../context/BusinessContext'
import BizBadge from '../components/BizBadge'
import PersonLink from '../components/PersonLink'
import PageHeader from '../components/PageHeader'

const PER_PAGE = 150

const ACTIVITY = {
  bay: {
    label: 'Bayway · FollowUpBoss',
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
    label: 'MPG · Zoho',
    accent: 'mpg',
    source: 'v_mpg_activity',
    // Calls only today — Zoho meetings/notes are gated behind module/admin
    // permissions the sync user lacks (see zoho-activity.ts).
    copy: 'MPG activity — calls from Zoho CRM.',
    empty: 'No activity yet — connect the Zoho activity sync (see docs/phase-activity-zoho-setup.md).',
    demoRows: [
      { id: 'd1', type: 'call', occurred_at: new Date(Date.now() - 2 * 3600000).toISOString(), contact_name: 'Northline Retail', snippet: 'Owner call — walked through pricing', owner: 'You', crm_profile_url: '#' },
      { id: 'd2', type: 'note', occurred_at: new Date(Date.now() - 5 * 3600000).toISOString(), contact_name: 'Bayside Diner', snippet: 'Statement received — analyzing effective rate', owner: 'You', crm_profile_url: '#' },
      { id: 'd3', type: 'appointment', occurred_at: new Date(Date.now() - 27 * 3600000).toISOString(), contact_name: 'Craft Pita', snippet: 'Merchant demo — terminal + gateway', owner: 'You', crm_profile_url: '#' },
      { id: 'd4', type: 'call', occurred_at: new Date(Date.now() - 30 * 3600000).toISOString(), contact_name: 'Heights Auto', snippet: 'Left VM re: proposal follow-up', owner: 'You', crm_profile_url: '#' },
    ],
  },
}

// The 'call' tag takes the row's business accent (green Bayway / blue MPG),
// so in the merged feed a call's color says which book it belongs to; other
// types keep their shared semantic hue from TYPE_META.
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

// Both books in one timeline (/activity with the All filter).
const BOTH = {
  copy: 'Both books in one timeline — FollowUpBoss for Bayway, Zoho calls for MPG.',
  empty: 'No activity yet — connect the FollowUpBoss and Zoho activity syncs.',
}

async function fetchPage(book, offset) {
  const { data, error } = await supabase
    .from(ACTIVITY[book].source)
    .select('*')
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)
  if (error) throw new Error(error.message)
  return data || []
}

// biz: 'bay' | 'mpg' for a book's own page; omitted, the page follows the
// business filter and All merges both books (mergeFeeds).
export default function Activity({ biz }) {
  const filter = useBusiness()?.biz || 'all'
  const scope = biz || filter
  const books = useMemo(() => (scope === 'all' ? ['bay', 'mpg'] : [scope]), [scope])
  const config = books.length > 1 ? BOTH : ACTIVITY[books[0]]

  // { [book]: { rows, hasMore } }
  const [feeds, setFeeds] = useState({})
  const [loading, setLoading] = useState(!isDemoMode)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const pages = await Promise.all(books.map((b) => fetchPage(b, 0)))
      setFeeds(Object.fromEntries(books.map((b, i) => [b, { rows: pages[i], hasMore: pages[i].length === PER_PAGE }])))
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [books])

  useEffect(() => {
    load()
  }, [load])

  const loadOlder = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const more = books.filter((b) => feeds[b]?.hasMore)
      const pages = await Promise.all(more.map((b) => fetchPage(b, feeds[b].rows.length)))
      setFeeds((prev) => {
        const next = { ...prev }
        more.forEach((b, i) => {
          next[b] = { rows: [...prev[b].rows, ...pages[i]], hasMore: pages[i].length === PER_PAGE }
        })
        return next
      })
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  const merged = useMemo(
    () =>
      mergeFeeds(
        books.map((b) => (isDemoMode ? { biz: b, rows: ACTIVITY[b].demoRows, hasMore: false } : { biz: b, ...(feeds[b] || { rows: [], hasMore: false }) })),
      ),
    [books, feeds],
  )
  const sourceRows = merged.rows
  const hasMore = merged.hasMore
  const groups = useMemo(() => groupByDay(filterByType(sourceRows, typeFilter)), [sourceRows, typeFilter])
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  return (
    <div>
      <PageHeader
        eyebrow={books.length > 1 ? 'Both books' : config.label}
        eyebrowColor={books.length > 1 ? undefined : `var(--${config.accent}-ink)`}
        title="Activity"
        note={!loading && !error && <span className="num text-[12px] text-muted">{total} shown</span>}
        subtitle={config.copy}
      />

      <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:mt-4 sm:flex-wrap sm:px-0">
        {TYPE_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setTypeFilter(c.key)}
            className={`min-h-[36px] flex-none rounded-lg px-3 py-1.5 text-xs font-semibold sm:min-h-0 sm:px-2.5 ${
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
                    key={r.key}
                    data-activity={r.business_id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg sm:flex-nowrap"
                  >
                    {books.length > 1 && <BizBadge biz={r.business_id} />}
                    <TypeTag type={r.type} accent={r.business_id} />
                    <div className="num w-14 flex-none text-[12px] text-muted">{timeOfDay(r.occurred_at)}</div>
                    <div className="min-w-0 flex-1 truncate text-[13px] font-semibold sm:w-40 sm:flex-none">
                      <PersonLink id={r.contact_id} url={r.crm_profile_url}>{r.contact_name || '(unknown)'}</PersonLink>
                    </div>
                    {/* Phones: the detail wraps onto its own line instead of being cut off. */}
                    <div className="line-clamp-2 basis-full text-[12.5px] text-muted sm:line-clamp-1 sm:min-w-0 sm:flex-1 sm:basis-auto">{r.snippet || '—'}</div>
                    {r.owner && (
                      <div className="hidden w-28 flex-none truncate text-right text-[11px] text-dim sm:block">{r.owner}</div>
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
