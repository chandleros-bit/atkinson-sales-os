// Pure helpers for the Overview calendar rail (today-only agenda).
// No React, no I/O. Events are stored as UTC ISO; day math is browser-local,
// matching src/lib/calendar.js. Reuses dayKey so "today" means the same thing
// here as on the full Calendar page.
import { dayKey } from './calendar'

// Matches the outlook-sync pg_cron cadence (migration 0008: every 15 min).
export const SYNC_INTERVAL_MS = 15 * 60 * 1000

// Today's events only, all-day first, then ascending by start time.
// Rows without starts_at are dropped. Input is not mutated.
export function todayEvents(rows, now = Date.now()) {
  const today = dayKey(new Date(now).toISOString())
  return [...rows]
    .filter((e) => e.starts_at && dayKey(e.starts_at) === today)
    .sort((a, b) => {
      if (!!a.is_all_day !== !!b.is_all_day) return a.is_all_day ? -1 : 1
      return new Date(a.starts_at) - new Date(b.starts_at)
    })
}

// Stale when the newest successful outlook sync is more than one full interval
// past due (a cycle was missed). latestRanAtMs is null when no ok sync exists.
export function isSyncStale(latestRanAtMs, now = Date.now()) {
  if (!latestRanAtMs) return true
  return now - latestRanAtMs > 2 * SYNC_INTERVAL_MS
}
