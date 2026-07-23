import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { buildMyTasks } from '../lib/overview'
import { dueLabel } from '../lib/tasks'
import CrmLink from './CrmLink'

// Overdue reads red, due-today amber — the same urgency ladder as the Overview
// alert banner, so the rail and the banner never disagree.
const CHIP = {
  overdue: { background: '#FCEBEB', color: '#DC2626' },
  today: { background: 'rgba(232,180,95,.18)', color: 'var(--bay-gold)' },
}

export default function MyTasks() {
  const { matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [done, setDone] = useState({})
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false)
      return
    }
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
  // shows — the live Overview never renders this in demo anyway.
  const tasks = useMemo(
    () => buildMyTasks(rows.filter((r) => matches(r.business_id)), Date.now()),
    [rows, matches],
  )

  const overdue = tasks.filter((t) => t.bucket === 'overdue').length
  const dueToday = tasks.filter((t) => t.bucket === 'today').length
  const summary =
    tasks.length === 0
      ? 'Nothing due right now'
      : [dueToday && `${dueToday} due today`, overdue && `${overdue} overdue`]
          .filter(Boolean)
          .join(' · ')

  return (
    <section className="cc-card p-[20px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-bold tracking-tight">My Tasks</h3>
          <div className="mt-[3px] text-[12.5px] font-semibold text-dim">
            {loading ? 'Loading tasks…' : summary}
          </div>
        </div>
        <Link
          to="/tasks"
          aria-label="Open all tasks"
          title="Open all tasks"
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-panel2 text-muted hover:bg-hoverbg"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M7 17L17 7M17 7H8M17 7v9" />
          </svg>
        </Link>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="px-2 py-10 text-center text-sm text-muted">
          You&apos;re clear — nothing due today.
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <div className="mt-2.5 flex flex-col">
          {tasks.map((t) => {
            const isDone = !!done[t.id]
            const isMpg = t.business_id === 'mpg'
            const chip = CHIP[t.bucket] || CHIP.today
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                {/* Local-only: the checkbox marks a task done for this session.
                    Completion still happens in the CRM and lands via sync. */}
                <button
                  type="button"
                  onClick={() => setDone((d) => ({ ...d, [t.id]: !d[t.id] }))}
                  aria-pressed={isDone}
                  aria-label={isDone ? 'Mark not done' : 'Mark done'}
                  className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] border-2"
                  style={{
                    borderColor: isDone ? 'var(--accent)' : 'var(--line2)',
                    background: isDone ? 'var(--accent)' : 'var(--panel)',
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3.5"
                    style={{ opacity: isDone ? 1 : 0 }}
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[13.5px] font-semibold"
                    style={
                      isDone ? { color: 'var(--dim)', textDecoration: 'line-through' } : undefined
                    }
                  >
                    {t.title || '(untitled task)'}
                  </div>
                  <div className="mt-[3px] flex items-center gap-[7px] text-[11.5px] text-dim">
                    <span
                      className="h-[7px] w-[7px] flex-none rounded-full"
                      style={{ background: isMpg ? 'var(--mpg)' : 'var(--bay)' }}
                    />
                    <span className="truncate">
                      {isMpg ? 'MPG' : 'Bayway'}
                      {t.task_type ? ` · ${t.task_type}` : ''}
                      {t.contact_name ? ' · ' : ''}
                      <CrmLink url={t.crm_profile_url}>{t.contact_name || ''}</CrmLink>
                    </span>
                  </div>
                </div>

                <span
                  className="flex-none whitespace-nowrap rounded-full px-[9px] py-1 text-[11px] font-bold"
                  style={chip}
                >
                  {t.bucket === 'overdue' ? dueLabel(t.due_at) : 'Today'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
