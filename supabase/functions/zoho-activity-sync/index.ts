// Scheduled Zoho CRM (MPG) ACTIVITY sync (calls, meetings, notes). Separate
// from zoho-sync / zoho-task-sync so it runs on its own cadence and logs its
// own sync_log line ('zoho-activity'). Read-only against Zoho: only GETs, never
// writes back. Until the ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET /
// ZOHO_REFRESH_TOKEN secrets are set this logs a "credentials not set" error
// row each run — expected, and visible on Sync Status exactly like zoho-sync.
// See docs/phase-activity-zoho-setup.md.

import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { getAccessToken } from '../_shared/zoho.ts'
import { fetchCalls, mapActivity } from '../_shared/zoho-activity.ts'

const NINETY_DAYS_MS = 90 * 86_400_000

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const { accessToken, apiHost } = await getAccessToken()

    // Zoho record id -> our contacts.id, so activities resolve their contact.
    // Contacts are synced from both Zoho Leads and Contacts (see zoho.ts), so
    // Who_Id / Parent_Id ids land in this same map. Paginate past the 1000-row
    // cap and fail loud on error — a truncated map would silently null the
    // contact link on every activity beyond it (same as fub-activity-sync).
    let contactMapRows
    try {
      contactMapRows = await fetchAll(() =>
        db.from('contacts').select('id, external_id').eq('source_crm', 'zoho'),
      )
    } catch (e) {
      throw new Error(`contact map: ${e?.message || e}`)
    }
    const contactIdByExternal = new Map(contactMapRows.map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run; first run is bounded to 90 days
    // so we don't pull the entire history at once. zohoList sends this as an
    // If-Modified-Since header (Zoho filters on Modified_Time).
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'zoho-activity')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || new Date(Date.now() - NINETY_DAYS_MS).toISOString()

    // Calls only. Meetings (Events) and Notes are deferred: the sync user's
    // Zoho profile has no read access to the Meetings module, and the list-all
    // Notes API is admin-only. Both mappings still live in zoho-activity.ts, so
    // re-enabling is a one-line change here once permissions are granted (or a
    // per-contact Notes pass is added). See docs/phase-activity-zoho-setup.md.
    // Kept as a list so adding modules back stays a one-liner; the per-module
    // try/catch also isolates any future addition's failure.
    const fetchers = [['call', fetchCalls]]

    const rows = []
    const counts = []
    const skipped = []
    for (const [type, fetchFn] of fetchers) {
      try {
        const records = await fetchFn(apiHost, accessToken, since)
        // An id-less record would map to external_id "<type>-undefined" and
        // collide under unique (source_crm, external_id) — drop it.
        for (const rec of records) {
          if (rec.id == null) continue
          rows.push(mapActivity(rec, type, contactIdByExternal))
        }
        counts.push(`${type}:${records.length}`)
      } catch (e) {
        skipped.push(`${type} (${String(e?.message || e).slice(0, 100)})`)
      }
    }

    if (rows.length) {
      const { error } = await db
        .from('activities')
        .upsert(rows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`activity upsert: ${error.message}`)
      upserted += rows.length
    }

    const summary = [counts.join(' '), skipped.length ? `skipped ${skipped.join('; ')}` : '']
      .filter(Boolean)
      .join(' | ')
    // Error only on a total wipeout — every module failed (counts gets an entry
    // for every module that returned).
    const allFailed = counts.length === 0
    await logSync(db, 'zoho-activity', allFailed ? 'error' : 'ok', upserted, summary || null)
    return new Response(JSON.stringify({ ok: !allFailed, upserted, counts, skipped }), {
      status: allFailed ? 500 : 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'zoho-activity', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
