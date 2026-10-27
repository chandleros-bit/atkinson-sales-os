// The page header's "last update" dot: are FollowUpBoss, Zoho and Outlook
// syncing on time? Pure, no React, no I/O. Reads the latest sync_log row per
// source (useSyncHealth fetches them).

// The feeds the dashboard's numbers come from. Each runs every 15 minutes or
// faster (FUB every 2), so three missed runs means stale. The webhook, task
// and activity syncs show on the Sync Status page, not here.
export const CORE_SOURCES = [
  { source: 'fub', label: 'FollowUpBoss' },
  { source: 'zoho', label: 'Zoho' },
  { source: 'outlook-mpg', label: 'Outlook MPG' },
  { source: 'outlook-bayway', label: 'Outlook Bayway' },
]
export const STALE_MINUTES = 45

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return 'never'
  const mins = Math.round((now - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// latest: { [source]: { ran_at, status } }, missing = never synced.
// -> { state: 'ok' | 'stale' | 'error' | 'unknown', text, detail }
// A source with no rows is "not connected" and doesn't turn the dot amber;
// the Sync Status page is where that gets fixed.
export function syncHealth(latest, now = Date.now()) {
  const detail = CORE_SOURCES.map(({ source, label }) => {
    const row = latest?.[source]
    if (!row) return { source, label, state: 'missing', text: 'not connected' }
    if (row.status !== 'ok') return { source, label, state: 'error', text: `failed ${timeAgo(row.ran_at, now)}`, ranAt: row.ran_at }
    const mins = (now - new Date(row.ran_at).getTime()) / 60000
    return { source, label, state: mins > STALE_MINUTES ? 'stale' : 'ok', text: timeAgo(row.ran_at, now), ranAt: row.ran_at }
  })
  const seen = detail.filter((d) => d.state !== 'missing')
  if (seen.length === 0) return { state: 'unknown', text: 'No sync yet', detail }
  const oldest = (list) => list.reduce((a, b) => (new Date(b.ranAt) < new Date(a.ranAt) ? b : a))
  const failed = seen.filter((d) => d.state === 'error')
  if (failed.length) return { state: 'error', text: `${failed[0].label} sync failed`, detail }
  const stale = seen.filter((d) => d.state === 'stale')
  if (stale.length) {
    const s = oldest(stale)
    return { state: 'stale', text: `${s.label} last synced ${s.text}`, detail }
  }
  // Everything is at least as fresh as the oldest feed.
  return { state: 'ok', text: `Synced ${oldest(seen).text}`, detail }
}
