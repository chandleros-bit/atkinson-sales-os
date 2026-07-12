// Scheduled Outlook calendar sync via published ICS feeds.
// Triggered every 15 min by pg_cron (see docs/phase8-outlook-setup.md).
// Read-only: fetches ICS, writes to calendar_events. Never writes to Outlook.
import { serviceClient, logSync } from '../_shared/db.ts'
import { fetchAndExpand } from '../_shared/ics.ts'

const FEEDS = [
  { source: 'outlook-mpg', envVar: 'OUTLOOK_MPG_ICS_URL' },
  { source: 'outlook-bayway', envVar: 'OUTLOOK_BAYWAY_ICS_URL' },
]

const DAY = 86_400_000

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
