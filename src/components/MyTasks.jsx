import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { buildMyTasks } from '../lib/overview'
import { dueLabel, dueTimeOfDay, BUCKET_META } from '../lib/tasks'
import CrmLink from './CrmLink'

// 46px-wide business chip, same as the Tasks board (src/pages/Tasks.jsx).
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

export default function MyTasks() {
  const { matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('v_tasks')
          .select('id, business_id, task_type, title, due_at, contact_name, crm_profile_url')
          .order('due_at', { ascending: true, nullsFirst: false })
        if (!alive) return
        if (err) setError(err.message)
        else setRows(data || [])
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

  // In demo mode the fetch is skipped, so rows stays [] and the empty state
  // shows — the live Overview views never render this in demo anyway.
  const tasks = useMemo(
    () => buildMyTasks(rows.filter((r) => matches(r.business_id)), Date.now()),
    [rows, matches],
  )

  return (
    <div className="mt-5 rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          My Tasks
          {!loading && !error && (
            <span className="num text-[11px] font-medium text-muted">{tasks.length}</span>
          )}
        </div>
        <Link to="/tasks" className="text-xs font-semibold text-muted hover:text-white">
          Show all →
        </Link>
      </div>

      {loading && <div className="px-6 py-8 text-center text-sm text-muted">Loading tasks…</div>}

      {error && (
        <div className="m-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-muted">
          You&apos;re clear — nothing due today.
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <div>
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
            >
              <BizTag business_id={t.business_id} />
              <div
                className="num w-24 flex-none text-[12px]"
                style={{ color: t.bucket === 'overdue' ? BUCKET_META.overdue.color : 'var(--muted)' }}
              >
                {t.bucket === 'overdue' ? dueLabel(t.due_at) : dueTimeOfDay(t.due_at)}
              </div>
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {t.title || '(untitled task)'}
                {t.task_type && (
                  <span className="ml-2 text-[11px] font-normal text-dim">{t.task_type}</span>
                )}
              </div>
              <div className="w-40 flex-none truncate text-right text-[12.5px] text-muted">
                <CrmLink url={t.crm_profile_url}>{t.contact_name || '—'}</CrmLink>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
