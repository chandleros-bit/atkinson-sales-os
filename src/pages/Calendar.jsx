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

// An all-day event is stored anchored at midnight UTC on its own date — NOT
// local midnight — so demo data must use that shape to exercise the same path
// production takes.
function allDayIsoIn(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString()
}

const demoRows = [
  { id: 'd1', source_account: 'outlook-bayway', title: 'Closing — Ramirez', starts_at: new Date(Date.now() + 3 * 3600000).toISOString(), location: 'Title Co.', is_all_day: false },
  { id: 'd3', source_account: 'outlook-bayway', title: 'Quarterly planning', starts_at: allDayIsoIn(0), location: null, is_all_day: true },
  { id: 'd4', source_account: 'outlook-bayway', title: 'Rate lock — Nguyen', starts_at: new Date(Date.now() + 5 * 3600000).toISOString(), location: 'Phone', is_all_day: false },
  { id: 'd2', source_account: 'outlook-mpg', title: 'Merchant demo — Craft Pita', starts_at: new Date(Date.now() + 26 * 3600000).toISOString(), location: null, is_all_day: false },
  { id: 'd5', source_account: 'outlook-mpg', title: 'Underwriting call — Bay Deli', starts_at: allDayIsoIn(4), location: null, is_all_day: false },
]

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
      className="grid h-9 w-9 place-items-center rounded-[10px] bg-panel2 text-muted hover:bg-hoverbg"
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
        // calendar_events last held — the grid never goes blank on stale data.
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

  const sourceRows = isDemoMode ? demoRows : rows

  // The sidebar filter is authoritative; the tabs only subdivide the combined
  // view, so they are hidden when a single book is already selected.
  const showTabs = biz === 'all'
  const visible = useMemo(
    () =>
      sourceRows.filter((e) => {
        const b = sourceToBiz(e.source_account)
        if (!matches(b)) return false
        return !showTabs || tab === 'all' || b === tab
      }),
    [sourceRows, matches, showTabs, tab],
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
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Calendar</h2>
        {stale && (
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{ background: 'rgba(232,180,95,.18)', color: 'var(--bay-gold)' }}
            title="Outlook sync is behind — showing the last synced data."
          >
            Stale
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        {biz === 'mpg'
          ? 'MPG calendar — merchant meetings.'
          : biz === 'bay'
            ? 'Bayway calendar — closings and appointments.'
            : 'Monthly view across both Outlook calendars, colored by source.'}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
              <h3 className="text-[19px] font-bold tracking-tight">
                {monthLabel(view.year, view.month)}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-[10px] bg-panel2 px-3 py-1.5 text-[12.5px] font-semibold text-muted hover:bg-hoverbg"
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

            {showTabs && (
              <div className="mt-4 flex items-center gap-[22px] border-b border-line">
                {TABS.map((t) => (
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
                ))}
              </div>
            )}

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
            <div className="grid grid-cols-7 gap-[4px]">
              {cells.map((c) =>
                c.blank ? (
                  <div key={c.key} className="h-[86px] rounded-[12px]" />
                ) : (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSelected(c.key)}
                    aria-pressed={c.key === selected}
                    className="relative flex h-[86px] flex-col items-stretch rounded-[12px] border p-1.5 text-left transition-colors"
                    style={{
                      borderColor: c.key === selected ? 'var(--accent)' : 'var(--line)',
                      background:
                        c.key === selected ? 'var(--accent-soft)' : 'var(--panel)',
                    }}
                  >
                    <span
                      className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[12.5px]"
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
                        <span className="text-[10.5px] font-semibold text-dim">
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
              <h3 className="text-[15px] font-bold tracking-tight">{dayLabel(selected)}</h3>
              <span className="num text-[12px] text-muted">
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
        </div>
      )}
    </div>
  )
}
