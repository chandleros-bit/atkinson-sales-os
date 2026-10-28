// Scheduled Outlook calendar sync via published ICS feeds.
// Triggered every 15 min by pg_cron (see docs/phase8-outlook-setup.md).
// Read-only: fetches ICS, writes to calendar_events (upserts the window, prunes
// what the feed dropped). Never writes to Outlook.
import { serviceClient, logSync } from '../_shared/db.ts'
import { fetchAndExpand } from '../_shared/ics.ts'
import { isCanceled } from '../_shared/ics-map.ts'

const FEEDS = [
  { source: 'outlook-mpg', envVar: 'OUTLOOK_MPG_ICS_URL' },
  { source: 'outlook-bayway', envVar: 'OUTLOOK_BAYWAY_ICS_URL' },
]

const DAY = 86_400_000

// Upsert alone never removes anything, so an event deleted or canceled in
// Outlook stayed on the dashboard forever. After a good fetch, drop this feed's
// rows in the sync window that the feed no longer has, plus any canceled
// leftovers from before the feed skipped them (past ones included).
async function prune(db, source, rows, windowStart, windowEnd) {
  const keep = new Set(rows.map((r) => r.external_id))
  const { data, error } = await db
    .from('calendar_events')
    .select('id, external_id, title, starts_at')
    .eq('source_account', source)
  if (error) throw new Error(`prune read: ${error.message}`)
  const stale = (data || [])
    .filter((r) => {
      if (isCanceled({ summary: r.title })) return true
      const t = r.starts_at ? new Date(r.starts_at).getTime() : NaN
      return t >= windowStart && t < windowEnd && !keep.has(r.external_id)
    })
    .map((r) => r.id)
  for (let i = 0; i < stale.length; i += 100) {
    const { error: delError } = await db.from('calendar_events').delete().in('id', stale.slice(i, i + 100))
    if (delError) throw new Error(`prune: ${delError.message}`)
  }
}

Deno.serve(async () => {
  const db = serviceClient()
  const now = Date.now()
  const windowStart = now
  const windowEnd = now + 60 * DAY
  const result = {}

  for (const feed of FEEDS) {
    try {
      const url = Deno.env.get(feed.envVar)
      if (!url) throw new Error(`${feed.envVar} not set as a function secret`)
      const rows = (await fetchAndExpand(url, windowStart, windowEnd)).map((r) => ({
        ...r,
        source_account: feed.source,
      }))
      if (rows.length) {
        const { error } = await db
          .from('calendar_events')
          .upsert(rows, { onConflict: 'source_account,external_id' })
        if (error) throw new Error(`upsert: ${error.message}`)
      }
      await prune(db, feed.source, rows, windowStart, windowEnd)
      await logSync(db, feed.source, 'ok', rows.length)
      result[feed.source] = rows.length
    } catch (err) {
      await logSync(db, feed.source, 'error', 0, String(err?.message || err))
      result[feed.source] = `error: ${String(err?.message || err)}`
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'content-type': 'application/json' },
  })
})
