import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { liveEvents, sourceToBiz, timeLabel, eventDayKey, dayLabel } from '../lib/calendar'
import { isSyncStale, eventsForDay } from '../lib/calendarRail'
import { monthCells, monthLabel, eventDots, todayKey, WEEKDAYS } from '../lib/overviewCards'
import PageHeader from '../components/PageHeader'
import { openPerson } from '../components/PersonSheet'
import { OsTag } from '../components/ScheduleEvent'
import { fetchContactEvents, toCalendarEvent, onContactEventsChanged } from '../lib/contactEvents'

import { demoCalendarEvents } from '../lib/demoData'
import { friendlyError } from '../lib/friendlyError'

const OUTLOOK_SOURCES = ['outlook-mpg', 'outlook-bayway']


// The month grid is fed by one query. The range always includes today as well
// as the visible month, so navigating away from this month never empties the
// "today" fallback.
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
      className="grid h-9 w-9 place-items-center rounded-lg bg-panel2 text-muted hover:bg-hoverbg"
    >
      {children}
    </button>
  )
}

export default function Calendar() {
  const { biz, matches } = useBusiness()
  const now = new Date()
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selected, setSelected] = useState(todayKey())
  const [rows, setRows] = useState([])
  const [lastSync, setLastSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  // Calls and meetings scheduled in the app reload in place after a save.
  const [osBump, setOsBump] = useState(0)
  const quietReload = useRef(false)
  useEffect(
    () =>
      onContactEventsChanged(() => {
        quietReload.current = true
        setOsBump((n) => n + 1)
      }),
    [],
  )

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      if (!quietReload.current) setLoading(true)
      quietReload.current = false
      setError(null)
      try {
        const { from, to } = rangeFor(view.year, view.month)
        const [evRes, syncRes, osRes] = await Promise.all([
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
          fetchContactEvents({ from, to }),
        ])
        if (!alive) return
        // A failed sync never deletes rows, so on error we still show whatever
        // calendar_events last held — the grid never goes blank on stale data.
        if (evRes.error) {
          setError(evRes.error.message)
          return
        }
        // Our own events never block the Outlook ones: a failed read shows none.
        setRows([...liveEvents(evRes.data), ...(osRes.data || []).map(toCalendarEvent)])
        setLastSync(syncRes.data?.ran_at ? new Date(syncRes.data.ran_at).getTime() : null)
      } catch (e) {
        if (alive) setError(friendlyError(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [view.year, view.month, osBump])

  const sourceRows = useMemo(() => (isDemoMode ? demoCalendarEvents() : rows), [rows])

  // The top-bar business switch is the only filter: one control, one answer.
  const visible = useMemo(
    () => sourceRows.filter((e) => matches(sourceToBiz(e.source_account))),
    [sourceRows, matches],
  )

  const dots = useMemo(
    () => eventDots(visible, eventDayKey, (e) => sourceToBiz(e.source_account)),
    [visible],
  )
  const cells = useMemo(() => monthCells(view.year, view.month, dots), [view, dots])

  // Per-day event counts for the in-cell chips. Built once per visible set so
  // each cell reads its own day without re-filtering the whole list.
  const countByKey = useMemo(() => {
    const m = new Map()
    for (const e of visible) {
      if (!e.starts_at) continue
      const k = eventDayKey(e)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [visible])

  const dayEvents = useMemo(() => eventsForDay(visible, selected), [visible, selected])

  const stale = !isDemoMode && !loading && !error && isSyncStale(lastSync)
  const tKey = todayKey()

  function shiftMonth(delta) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function goToday() {
    const d = new Date()
    setView({ year: d.getFullYear(), month: d.getMonth() })
    setSelected(todayKey())
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        note={
          stale && (
            <span
              className="rounded-full px-2 py-0.5 text-micro font-semibold"
              style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}
              title="Outlook sync is behind — showing the last synced data."
            >
              Stale
            </span>
          )
        }
        subtitle={
          biz === 'mpg'
            ? 'MPG calendar — merchant meetings.'
            : biz === 'bay'
              ? 'Bayway calendar — closings and appointments.'
              : 'Monthly view across both Outlook calendars, colored by source.'
        }
      />

      {error && (
        <div className="mt-4 rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-xs text-neg-ink">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-sm text-muted">Loading calendar…</div>
      ) : (
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ---- Month grid ---- */}
          <section className="cc-card p-[20px]">
            <div className="flex items-center justify-between">
              <h3 className="text-lead font-bold tracking-tight">
                {monthLabel(view.year, view.month)}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-lg bg-panel2 px-3 py-1.5 text-body font-semibold text-muted hover:bg-hoverbg"
                >
                  Today
                </button>
                <NavButton label="Previous month" onClick={() => shiftMonth(-1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </NavButton>
                <NavButton label="Next month" onClick={() => shiftMonth(1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </NavButton>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={`pb-2 text-center text-micro font-bold ${i >= 5 ? 'text-dim/70' : 'text-dim'}`}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-[4px]">
              {cells.map((c) =>
                c.blank ? (
                  <div key={c.key} className="h-[86px] rounded-lg" />
                ) : (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSelected(c.key)}
                    aria-pressed={c.key === selected}
                    className="relative flex h-[86px] flex-col items-stretch rounded-lg border p-1.5 text-left transition-colors"
                    style={{
                      borderColor: c.key === selected ? 'var(--accent)' : 'var(--line)',
                      background:
                        c.key === selected ? 'var(--accent-soft)' : 'var(--panel)',
                    }}
                  >
                    <span
                      className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-body"
                      style={{
                        background: c.key === tKey ? 'var(--accent)' : 'transparent',
                        color:
                          c.key === tKey ? '#fff'
                          : c.key === selected ? 'var(--accent-ink)'
                          : 'var(--muted)',
                        fontWeight: c.key === tKey || c.key === selected ? 800 : 600,
                      }}
                    >
                      {c.day}
                    </span>
                    {c.dot && (
                      <span className="mt-auto flex items-center gap-1 pl-0.5">
                        <span
                          className="h-[6px] w-[6px] flex-none rounded-full"
                          style={{ background: c.dot }}
                        />
                        <span className="text-micro font-semibold text-dim">
                          {countByKey.get(c.key) || 0}
                        </span>
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          </section>

          {/* ---- Selected-day agenda ---- */}
          <section className="cc-card p-[20px]">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-ui font-bold tracking-tight">{dayLabel(selected)}</h3>
              <span className="num text-caption text-muted">
                {dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}
              </span>
            </div>

            {dayEvents.length === 0 ? (
              <div className="px-2 py-10 text-center text-sm text-muted">No events</div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {dayEvents.map((e) => {
                  const evBiz = sourceToBiz(e.source_account)
                  const color = evBiz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
                  // timeLabel gives "9:30 AM" for timed events and "All day" for
                  // the rest; only the timed form splits into a value and suffix.
                  const [time, ampm] = e.is_all_day ? ['All', 'day'] : timeLabel(e).split(' ')
                  // Calls and meetings scheduled in the app open their contact.
                  const Row = e.os ? 'button' : 'div'
                  return (
                    <Row
                      key={e.id}
                      {...(e.os ? { type: 'button', onClick: () => openPerson(e.contact_id), 'data-os-event': e.kind } : {})}
                      className={`flex items-start gap-3 rounded-card bg-panel2 p-3.5 text-left ${e.os ? 'hover:bg-hoverbg' : ''} ${e.status === 'done' ? 'opacity-60' : ''}`}
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <div className="min-w-[44px] flex-none text-center">
                        <div className="num text-ui font-extrabold leading-none">{time}</div>
                        {ampm && <div className="mt-0.5 text-micro font-bold text-dim">{ampm}</div>}
                      </div>
                      <div className="min-w-0">
                        <div className="text-body font-bold">
                          {e.title || '(no title)'}
                          {e.os && <OsTag done={e.status === 'done'} />}
                        </div>
                        {e.location && (
                          <div className="mt-0.5 truncate text-caption leading-snug text-dim">
                            {e.location}
                          </div>
                        )}
                      </div>
                    </Row>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
