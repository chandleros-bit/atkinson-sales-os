// Weekly Freddie Mac PMMS load (Database Opportunity Agent, spec build step 1).
// Pulls the 30- and 15-year weekly series from FRED and upserts every week
// since 2018 into pmms_weekly, so the first run is also the history seed.
// Scheduled by 0066 (Thursdays 8 PM Central). Logs sync_log
// source 'pmms-refresh'. Deployed --no-verify-jwt like the other cron functions.

import { serviceClient, logSync } from '../_shared/db.ts'
import { FRED_PMMS_URL, parseFredPmms } from '../_shared/pmms.ts'

Deno.serve(async () => {
  const db = serviceClient()
  try {
    const res = await fetch(FRED_PMMS_URL)
    if (!res.ok) throw new Error(`FRED ${res.status}`)
    const rows = parseFredPmms(await res.text())
    if (!rows.length) throw new Error('FRED returned no PMMS weeks')
    const { error } = await db.from('pmms_weekly').upsert(rows, { onConflict: 'week_date' })
    if (error) throw new Error(`pmms_weekly write: ${error.message}`)
    const last = rows[rows.length - 1]
    await logSync(db, 'pmms-refresh', 'ok', rows.length, `latest ${last.week_date}: ${last.rate_30_fixed}%`)
    return Response.json({ ok: true, weeks: rows.length, latest: last })
  } catch (err) {
    await logSync(db, 'pmms-refresh', 'error', 0, String(err?.message || err))
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 })
  }
})
