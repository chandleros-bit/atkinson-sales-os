import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import {
  BUCKET_META,
  PRIORITY_META,
  PRIORITY_CHIPS,
  bucketByDue,
  dueLabel,
  dueTimeOfDay,
  filterByPriority,
  normalizePriority,
} from '../lib/tasks'
import CrmLink from '../components/CrmLink'
import QuickActions from '../components/QuickActions'

// One generous window; both books together are far under this today. If a book
// ever exceeds it the "Load more" button pages the rest in.
const PER_PAGE = 300

const DEMO_ROWS = [
  { id: 'd1', business_id: 'bay', title: 'Call Marcus re: rate lock', task_type: 'Call', due_at: new Date(Date.now() - 2 * 86400000).toISOString(), priority: 'High', owner: 'You', contact_name: 'Marcus Ramirez', crm_profile_url: '#' },
  { id: 'd2', business_id: 'bay', title: 'Send pre-approval letter', task_type: 'Email', due_at: new Date(Date.now() + 3 * 3600000).toISOString(), priority: 'Normal', owner: 'You', contact_name: 'Priya Nair', crm_profile_url: '#' },
  { id: 'd3', business_id: 'mpg', title: 'Follow up on MPG proposal', task_type: 'Email', due_at: new Date(Date.now() + 26 * 3600000).toISOString(), priority: 'High', owner: 'You', contact_name: 'Northline Retail', crm_profile_url: '#' },
  { id: 'd4', business_id: 'mpg', title: 'Collect statements', task_type: 'Call', due_at: new Date(Date.now() + 5 * 86400000).toISOString(), priority: 'Low', owner: 'You', contact_name: 'Bayside Diner', crm_profile_url: '#' },
  { id: 'd5', business_id: 'bay', title: 'Order appraisal', task_type: null, due_at: null, priority: null, owner: 'You', contact_name: 'Kevin Osei', crm_profile_url: '#' },
]

function BizTag({ business_id }) {
  const mpg = business_id === 'mpg'
  return (
    <span
      className="flex-none rounded px-1.5 py-0.5 text-center text-[9.5px] font-bold tracking-wide"
      style={{
        color: mpg ? 'var(--mpg)' : 'var(--bay)',
        background: mpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
        width: 46,
      }}
    >
      {mpg ? 'MPG' : 'BAYWAY'}
    </span>
  )
}

// Overdue and Upcoming span many days, so a bare time is ambiguous there — two
// rows both reading "9:00a" could be a week apart. Those buckets show the day;
// Today and Tomorrow already have it in the section header, so they show time.
function DueCell({ bucketKey, due_at, className = 'w-24' }) {
  const spansDays = bucketKey === 'overdue' || bucketKey === 'upcoming'
  return (
    <div className={`num flex-none text-[12px] text-muted ${className}`}>
      {spansDays ? dueLabel(due_at) : dueTimeOfDay(due_at)}
    </div>
  )
}

function PriorityTag({ priority, compact = false }) {
  const key = normalizePriority(priority)
  if (!key) return compact ? null : <span className="w-12 flex-none" />
  const m = PRIORITY_META[key]
  return (
    <span
      className="w-12 flex-none rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: m.color, border: `1px solid ${m.border}` }}
    >
      {m.label}
    </span>
  )
}

export default function Tasks() {
  const { matches } = useBusiness()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState('all')

  const fetchPage = useCallback(async (offset, size = PER_PAGE) => {
    const { data, error: err } = await supabase
      .from('v_tasks')
      .select('*')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + size - 1)
    if (err) throw new Error(err.message)
    return data || []
  }, [])

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

  // After a Quick Action: re-read everything already on screen, quietly, so
  // a completed task drops off and a pushed one moves to its new day.
  const [pending, setPending] = useState({})
  const refresh = async () => {
    try {
      const page = await fetchPage(0, Math.max(rows.length, PER_PAGE))
      setRows(page)
      setPending({})
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  const loadMore = async () => {
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

  const sourceRows = isDemoMode ? DEMO_ROWS : rows
  const visible = useMemo(
    () => filterByPriority(sourceRows.filter((r) => matches(r.business_id)), priorityFilter),
    [sourceRows, matches, priorityFilter],
  )
  const groups = useMemo(() => bucketByDue(visible).filter((g) => g.rows.length > 0), [visible])
  const total = visible.length

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Tasks</h2>
        {!loading && !error && <span className="num text-[12px] text-muted">{total} open</span>}
      </div>
      <p className="mt-1 hidden text-sm text-muted sm:block">
        Every open follow-up across both books — FollowUpBoss (Bayway) and Zoho (MPG). Complete or
        push a task here and it changes in the CRM too.
      </p>

      <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:mt-4 sm:flex-wrap sm:px-0">
        {PRIORITY_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setPriorityFilter(c.key)}
            className={`min-h-[36px] flex-none rounded-lg px-3 py-1.5 text-xs font-semibold sm:min-h-0 sm:px-2.5 ${
              priorityFilter === c.key ? 'bg-hoverbg text-[color:var(--text)]' : 'text-muted hover:text-[color:var(--text)]'
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

      {loading && <div className="mt-6 text-sm text-muted">Loading tasks…</div>}

      {!loading && !error && sourceRows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No tasks yet — connect the task syncs (see docs/phase-tasks-setup.md).
        </div>
      )}

      {!loading && sourceRows.length > 0 && total === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          {/* Filters apply to the loaded window, so "nothing here" can mean
              "nothing yet" when more pages remain — say which. */}
          {hasMore
            ? 'No open tasks match the current filters in the loaded range — try Load more.'
            : 'No open tasks match the current filters.'}
        </div>
      )}

      {!loading && total > 0 && (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div
                className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: BUCKET_META[g.key].color }}
              >
                {g.label}
                <span className="num ml-2 text-dim">{g.rows.length}</span>
              </div>
              <div
                className="overflow-hidden rounded-card border bg-panel"
                style={{ borderColor: BUCKET_META[g.key].border }}
              >
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 transition-opacity last:border-b-0 hover:bg-hoverbg"
                    style={pending[r.id] ? { opacity: 0.35 } : undefined}
                  >
                    {/* Phones: title first, then book · due · priority · who on a second line. */}
                    <div className="hidden sm:contents">
                      <BizTag business_id={r.business_id} />
                      <DueCell bucketKey={g.key} due_at={r.due_at} />
                      <PriorityTag priority={r.priority} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[13.5px] font-semibold sm:line-clamp-1 sm:text-[13px]">
                        {r.title || '(untitled task)'}
                        {r.task_type && (
                          <span className="ml-2 text-[11px] font-normal text-dim">{r.task_type}</span>
                        )}
                      </div>
                      {r.contact_name && (
                        <div className="mt-0.5 truncate text-[12.5px] text-muted sm:hidden">
                          <CrmLink url={r.crm_profile_url}>{r.contact_name}</CrmLink>
                        </div>
                      )}
                      <div className="mt-1 flex min-w-0 items-center gap-2 sm:hidden">
                        <BizTag business_id={r.business_id} />
                        <DueCell bucketKey={g.key} due_at={r.due_at} className="w-auto" />
                        <PriorityTag priority={r.priority} compact />
                      </div>
                    </div>
                    <div className="hidden w-40 flex-none truncate text-[12.5px] text-muted lg:block">
                      <CrmLink url={r.crm_profile_url}>{r.contact_name || '—'}</CrmLink>
                    </div>
                    {r.owner && (
                      <div className="hidden w-28 flex-none truncate text-right text-[11px] text-dim xl:block">
                        {r.owner}
                      </div>
                    )}
                    <QuickActions
                      className="-my-1.5 -mr-2"
                      only={['call', 'done', 'push']}
                      businessId={r.business_id}
                      contactId={r.contact_id}
                      contactName={r.contact_name}
                      hasPhone={!!r.contact_phone}
                      task={{ id: r.id, title: r.title }}
                      onPending={() => setPending((p) => ({ ...p, [r.id]: true }))}
                      onFailed={() => setPending((p) => ({ ...p, [r.id]: false }))}
                      onDone={refresh}
                    />
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
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-line2 px-4 py-1.5 text-xs font-semibold text-muted hover:text-[color:var(--text)] disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
