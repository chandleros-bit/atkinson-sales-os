import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { sourceToBiz, timeLabel } from '../lib/calendar'
import { todayEvents, isSyncStale } from '../lib/calendarRail'

const DAY = 86_400_000
const OUTLOOK_SOURCES = ['outlook-mpg', 'outlook-bayway']

function startOfTodayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Demo rows so the widget renders in demo mode (isDemoMode) without Supabase.
const demoRows = [
  { id: 'c1', source_account: 'outlook-mpg', title: 'Quarterly planning', starts_at: new Date(startOfTodayMs()).toISOString(), location: null, is_all_day: true },
  { id: 'c2', source_account: 'outlook-mpg', title: 'Merchant demo — Craft Pita', starts_at: new Date(startOfTodayMs() + 10.5 * 3600000).toISOString(), location: 'Zoom', is_all_day: false },
  { id: 'c3', source_account: 'outlook-bayway', title: 'Closing — Ramirez', starts_at: new Date(startOfTodayMs() + 15 * 3600000).toISOString(), location: 'Title Co.', is_all_day: false },
]

export default function CalendarRail() {
  const { matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [lastSync, setLastSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const startMs = startOfTodayMs()
        const [evRes, syncRes] = await Promise.all([
          supabase
            .from('calendar_events')
            .select('id, source_account, title, starts_at, ends_at, location, is_all_day')
            .gte('starts_at', new Date(startMs).toISOString())
            .lt('starts_at', new Date(startMs + DAY).toISOString())
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
  }, [])

  const sourceRows = isDemoMode ? demoRows : rows
  const events = useMemo(
    () => todayEvents(sourceRows).filter((e) => matches(sourceToBiz(e.source_account))),
    [sourceRows, matches],
  )
  const stale = !isDemoMode && !loading && !error && isSyncStale(lastSync)

  return (
    <div className="mt-5 rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          Today
          {!loading && !error && (
            <span className="num text-[11px] font-medium text-muted">{events.length}</span>
          )}
        </div>
        {stale && (
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{ background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }}
            title="Outlook sync is behind — showing the last synced data."
          >
            Stale
          </span>
        )}
      </div>

      {loading && <div className="px-6 py-8 text-center text-sm text-muted">Loading calendar…</div>}

      {error && (
        <div className="m-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-muted">No events today</div>
      )}

      {!loading && !error && events.length > 0 && (
        <div>
          {events.map((e) => {
            const evBiz = sourceToBiz(e.source_account)
            const dot = evBiz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
                <div className="w-20 flex-none text-[12px] text-muted">{timeLabel(e)}</div>
                <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {e.title || '(no title)'}
                </div>
                {e.location && (
                  <div className="w-40 flex-none truncate text-right text-[11.5px] text-dim">
                    {e.location}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
