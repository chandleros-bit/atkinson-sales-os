import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { sourceToBiz, timeLabel, eventDayKey, dayLabel } from '../lib/calendar'
import { isSyncStale, eventsForDay } from '../lib/calendarRail'
import { monthCells, monthLabel, eventDots, todayKey, WEEKDAYS } from '../lib/overviewCards'

const OUTLOOK_SOURCES = ['outlook-mpg', 'outlook-bayway']

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'bay', label: 'Bayway' },
  { key: 'mpg', label: 'MPG' },
]

// The month grid and the day list are fed by one query. The range always
// includes today as well as the visible month, so navigating away from this
// month never empties the "today" fallback.
function rangeFor(year, month) {
  const now = new Date()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 1)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(todayStart.getTime() + 86_400_000)
  return {
    from: new Date(Math.min(monthStart.getTime(), todayStart.getTime())).toISOString(),
    to: new Date(Math.max(monthEnd.getTime(), tomorrow.getTime())).toISOString(),
  }
}

function NavButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-[9px] bg-panel2 text-muted hover:bg-hoverbg"
    >
      {children}
    </button>
  )
}

export default function CalendarCard() {
  const { biz, matches } = useBusiness()
  const now = new Date()
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selected, setSelected] = useState(todayKey())
  const [tab, setTab] = useState('all')
  const [rows, setRows] = useState([])
  const [lastSync, setLastSync] = useState(null)
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
        const { from, to } = rangeFor(view.year, view.month)
        const [evRes, syncRes] = await Promise.all([
          supabase
            .from('calendar_events')
            .select('id, source_account, title, starts_at, ends_at, location, is_all_day')
            .gte('starts_at', from)
            .lt('starts_at', to)
            .order('starts_at', { ascending: true }),
          supabase
            .from('sync_log')
            .select('ran_at, status')
            .in('source', OUTLOOK_SOURCES)
            .eq('status', 'ok')
            .order('ran_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (!alive) return
        // A failed sync never deletes rows, so on error we still show whatever
        // calendar_events last held — the widget never goes blank on stale data.
        if (evRes.error) {
          setError(evRes.error.message)
          return
        }
        setRows(evRes.data || [])
        setLastSync(syncRes.data?.ran_at ? new Date(syncRes.data.ran_at).getTime() : null)
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [view.year, view.month])

  // The sidebar filter is authoritative; the tabs only subdivide the combined
  // view, so they are hidden when a single book is already selected.
  const showTabs = biz === 'all'
  const visible = useMemo(
    () =>
      rows.filter((e) => {
        const b = sourceToBiz(e.source_account)
        if (!matches(b)) return false
        return !showTabs || tab === 'all' || b === tab
      }),
    [rows, matches, showTabs, tab],
  )

  const dots = useMemo(
    () => eventDots(visible, eventDayKey, (e) => sourceToBiz(e.source_account)),
    [visible],
  )
  const cells = useMemo(() => monthCells(view.year, view.month, dots), [view, dots])

  const dayEvents = useMemo(() => eventsForDay(visible, selected), [visible, selected])

  const stale = !isDemoMode && !loading && !error && isSyncStale(lastSync)
  const tKey = todayKey()

  function shiftMonth(delta) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  return (
    <section className="cc-card p-[20px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[18px] font-bold tracking-tight">
          {monthLabel(view.year, view.month)}
        </h3>
        <div className="flex items-center gap-2">
          {stale && (
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              style={{ background: 'rgba(232,180,95,.18)', color: 'var(--bay-gold)' }}
              title="Outlook sync is behind — showing the last synced data."
            >
              Stale
            </span>
          )}
          <NavButton label="Previous month" onClick={() => shiftMonth(-1)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </NavButton>
          <NavButton label="Next month" onClick={() => shiftMonth(1)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </NavButton>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`pb-2 text-center text-[11px] font-bold ${i >= 5 ? 'text-line2' : 'text-dim'}`}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((c) =>
          c.blank ? (
            <div key={c.key} className="h-[38px]" />
          ) : (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected(c.key)}
              aria-pressed={c.key === selected}
              className="relative grid h-[38px] place-items-center rounded-[11px] text-[13px]"
              style={{
                background:
                  c.key === tKey ? 'var(--accent)'
                  : c.key === selected ? 'var(--accent-soft)'
                  : 'transparent',
                color:
                  c.key === tKey ? '#fff'
                  : c.key === selected ? 'var(--accent-ink)'
                  : 'var(--muted)',
                fontWeight: c.key === tKey || c.key === selected ? 800 : 600,
              }}
            >
              {c.day}
              {c.dot && c.key !== tKey && (
                <span
                  className="absolute bottom-[5px] h-[5px] w-[5px] rounded-full"
                  style={{ background: c.dot }}
                />
              )}
            </button>
          ),
        )}
      </div>

      <div className="mt-5 flex items-center gap-[22px] border-b border-line">
        {showTabs ? (
          TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="-mb-px border-b-2 pb-2.5 text-[13.5px]"
              style={{
                borderColor: tab === t.key ? 'var(--accent)' : 'transparent',
                color: tab === t.key ? 'var(--text)' : 'var(--dim)',
                fontWeight: tab === t.key ? 800 : 600,
              }}
            >
              {t.label}
            </button>
          ))
        ) : (
          <span className="-mb-px border-b-2 border-[color:var(--accent)] pb-2.5 text-[13.5px] font-extrabold">
            {biz === 'mpg' ? 'MPG' : 'Bayway'}
          </span>
        )}
        <span className="ml-auto pb-2.5 text-[12px] font-semibold text-dim">
          {dayLabel(selected)}
        </span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {loading && <div className="px-2 py-8 text-center text-sm text-muted">Loading calendar…</div>}

      {!loading && !error && dayEvents.length === 0 && (
        <div className="px-2 py-8 text-center text-sm text-muted">No events</div>
      )}

      {!loading && !error && dayEvents.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {dayEvents.map((e) => {
            const evBiz = sourceToBiz(e.source_account)
            const color = evBiz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
            // timeLabel gives "9:30 AM" for timed events and "All day" for the
            // rest; only the timed form splits into a value and a suffix.
            const [time, ampm] = e.is_all_day ? ['All', 'day'] : timeLabel(e).split(' ')
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-[14px] bg-panel2 p-3.5"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <div className="min-w-[44px] flex-none text-center">
                  <div className="num text-[14px] font-extrabold leading-none">{time}</div>
                  {ampm && <div className="mt-0.5 text-[10px] font-bold text-dim">{ampm}</div>}
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold">{e.title || '(no title)'}</div>
                  {e.location && (
                    <div className="mt-0.5 truncate text-[12px] leading-snug text-dim">
                      {e.location}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
