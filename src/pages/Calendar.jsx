import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { sourceToBiz, timeLabel, groupByDay } from '../lib/calendar'

const DAY = 86_400_000

function startOfTodayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

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
  { id: 'd2', source_account: 'outlook-mpg', title: 'Merchant demo — Craft Pita', starts_at: new Date(Date.now() + 26 * 3600000).toISOString(), location: null, is_all_day: false },
]

export default function Calendar() {
  const { biz, matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const startMs = startOfTodayMs()
      const { data, error: err } = await supabase
        .from('calendar_events')
        .select('id, source_account, title, starts_at, ends_at, location, is_all_day')
        .gte('starts_at', new Date(startMs).toISOString())
        .lt('starts_at', new Date(startMs + 30 * DAY).toISOString())
        .order('starts_at', { ascending: true })
      if (err) {
        setError(err.message)
        return
      }
      setRows(data || [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sourceRows = isDemoMode ? demoRows : rows
  const groups = useMemo(() => {
    const visible = sourceRows.filter((e) => matches(sourceToBiz(e.source_account)))
    return groupByDay(visible)
  }, [sourceRows, matches])

  const total = groups.reduce((n, g) => n + g.events.length, 0)

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Calendar</h2>
        {!loading && !error && <span className="num text-[12px] text-muted">{total} upcoming</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {biz === 'mpg'
          ? 'MPG calendar — merchant meetings.'
          : biz === 'bay'
            ? 'Bayway calendar — closings and appointments.'
            : 'Upcoming across both Outlook calendars, colored by source.'}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading calendar…</div>}

      {!loading && !error && total === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No upcoming events — connect Outlook (see docs/phase8-outlook-setup.md).
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.dayKey}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">{g.label}</div>
              <div className="overflow-hidden rounded-card border border-line bg-panel">
                {g.events.map((e) => {
                  const evBiz = sourceToBiz(e.source_account)
                  const dot = evBiz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                    >
                      <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
                      <div className="w-20 flex-none text-[12px] text-muted">{timeLabel(e)}</div>
                      <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.title || '(no title)'}</div>
                      {e.location && (
                        <div className="w-40 flex-none truncate text-right text-[11.5px] text-dim">{e.location}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
