import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { liveEvents, sourceToBiz, timeLabel } from '../lib/calendar'
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

// The Overview "Today's Events" card: a compact, read-only agenda of the rep's events
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
          .select('id, source_account, title, starts_at, ends_at, is_all_day, location')
          .gte('starts_at', from)
          .lt('starts_at', to)
          .order('starts_at', { ascending: true })
        if (!alive) return
        if (err) setError(err.message)
        else setRows(liveEvents(data))
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

  const now = Date.now()
  const next = agenda.find((e) => !e.is_all_day && new Date(e.starts_at).getTime() > now)
  const mins = next ? Math.round((new Date(next.starts_at).getTime() - now) / 60000) : null
  const sub = agenda.length
    ? `${agenda.length} ${agenda.length === 1 ? 'event' : 'events'}${next ? ` · next in ${mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}` : ''}`
    : todayLabel()

  return (
    <section className={`cc-card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold tracking-[-0.2px]">Today&apos;s Events</h3>
          <div className="mt-0.5 text-[13px] text-muted">{sub}</div>
        </div>
        <Link to="/calendar" className="flex-none text-[13px] font-semibold text-[color:var(--chrome)] hover:underline">
          Calendar ↗
        </Link>
      </div>

      {error && (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {loading && <div className="px-5 py-8 text-center text-sm text-muted">Loading agenda…</div>}
      {!loading && !error && agenda.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-muted">Nothing on the calendar today.</div>
      )}

      {!loading && !error && agenda.length > 0 && (
        <div className="flex flex-col px-5 pb-3 pt-1">
          {agenda.map((e) => {
            const biz = sourceToBiz(e.source_account)
            const color = biz === 'mpg' ? 'var(--mpg)' : biz === 'bay' ? 'var(--bay)' : 'var(--dim)'
            const past = !e.is_all_day && new Date(e.ends_at || e.starts_at).getTime() < now
            return (
              <div key={e.id} data-event className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                <div className={`num w-[58px] flex-none text-[13px] font-semibold ${past ? 'text-dim' : ''}`}>
                  {e.is_all_day ? 'All day' : timeLabel(e)}
                </div>
                <span className="w-[3px] flex-none self-stretch rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{e.title || '(no title)'}</div>
                  <div className="truncate text-[12.5px] text-muted">
                    {[e.location, biz === 'mpg' ? 'MPG' : biz === 'bay' ? 'Bayway' : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {e === next && (
                  <span className="flex-none rounded-md border px-[7px] py-px text-[11.5px] font-semibold" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                    Next
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
