import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { sourceToBiz, timeLabel } from '../lib/calendar'
import { todayEvents } from '../lib/calendarRail'
import { todayKey } from '../lib/overviewCards'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Today's window: [midnight, tomorrow midnight) in local time, sent as ISO.
function todayWindow(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 86_400_000)
  return { from: start.toISOString(), to: end.toISOString() }
}

function todayLabel(now = new Date()) {
  return `${WEEKDAYS[now.getDay()]} ${now.getMonth() + 1}/${now.getDate()}`
}

// The Overview "Today" card: a compact, read-only agenda of the rep's events
// for the current day, scoped by the active business filter. Sibling of the
// full Calendar page — it reuses the same calendar_events source and helpers.
export default function TodayAgenda({ className = '' }) {
  const { matches } = useBusiness()
  const [rows, setRows] = useState([])
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
        const { from, to } = todayWindow()
        const { data, error: err } = await supabase
          .from('calendar_events')
          .select('id, source_account, title, starts_at, ends_at, is_all_day')
          .gte('starts_at', from)
          .lt('starts_at', to)
          .order('starts_at', { ascending: true })
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

  const agenda = useMemo(
    () => todayEvents(rows.filter((e) => matches(sourceToBiz(e.source_account)))),
    [rows, matches],
  )

  return (
    <section className={`cc-card flex flex-col p-[22px] ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-[17px] font-bold tracking-tight">Today</h3>
        <span className="text-[12.5px] font-semibold text-dim">{todayLabel()}</span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {loading && (
        <div className="px-2 py-8 text-center text-sm text-muted">Loading agenda…</div>
      )}
      {!loading && !error && agenda.length === 0 && (
        <div className="px-2 py-8 text-center text-sm text-muted">Nothing on the calendar today.</div>
      )}

      {!loading && !error && agenda.length > 0 && (
        <div className="mt-2 flex flex-col">
          {agenda.map((e) => {
            const biz = sourceToBiz(e.source_account)
            const color = biz === 'mpg' ? 'var(--mpg)' : biz === 'bay' ? 'var(--bay)' : 'var(--dim)'
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 border-b border-line py-[11px] last:border-b-0"
              >
                <div className="num w-16 flex-none text-[12px] font-bold text-muted">
                  {e.is_all_day ? 'All day' : timeLabel(e)}
                </div>
                <span
                  className="w-1 flex-none self-stretch rounded-full"
                  style={{ background: color }}
                />
                <div className="min-w-0 flex-1 text-[13px] font-semibold">
                  {e.title || '(no title)'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
