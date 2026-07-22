// Scheduled Zoho CRM (MPG) TASK sync. Separate from zoho-sync so it runs on
// its own cadence and logs its own sync_log line ('zoho-tasks'). Read-only
// against Zoho: only GETs, never writes back. Until the ZOHO_CLIENT_ID /
// ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN secrets are set this logs a
// "credentials not set" error row each run — expected, and visible on Sync
// Status exactly like zoho-sync. See docs/phase-tasks-setup.md.

import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { getAccessToken } from '../_shared/zoho.ts'
import { fetchTasks, mapTask } from '../_shared/zoho-tasks.ts'

// Same constants and rationale as fub-task-sync.
const OVERLAP_MS = 10 * 60_000
const BATCH = 500

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const { accessToken, apiHost } = await getAccessToken()

    // Zoho contact id -> our contacts.id, Zoho deal id -> our deals.id.
    // Paginate past the 1000-row cap and fail loud on error — see the
    // fub-task-sync comment. MPG's Zoho book is tiny today, but the map read
    // must not silently truncate if it ever grows.
    let contactMapRows
    try {
      contactMapRows = await fetchAll(() =>
        db.from('contacts').select('id, external_id').eq('source_crm', 'zoho'),
      )
    } catch (e) {
      throw new Error(`contact map: ${e?.message || e}`)
    }
    const contactIdByExternal = new Map(contactMapRows.map((r) => [r.external_id, r.id]))

    let dealMapRows
    try {
      dealMapRows = await fetchAll(() =>
        db.from('deals').select('id, external_id').eq('source_crm', 'zoho'),
      )
    } catch (e) {
      throw new Error(`deal map: ${e?.message || e}`)
    }
    const dealIdByExternal = new Map(dealMapRows.map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'zoho-tasks')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Same overlap re-scan as fub-task-sync: ran_at is stamped at run end, so
    // a strict cursor can lose a task updated mid-run. Upsert is idempotent.
    const since = lastOk?.ran_at
      ? new Date(new Date(lastOk.ran_at).getTime() - OVERLAP_MS).toISOString()
      : null

    const records = await fetchTasks(apiHost, accessToken, since)
    // Same guard as fub-task-sync: an id-less record would map to external_id
    // "undefined" and collide on unique (source_crm, external_id).
    const identified = records.filter((rec) => rec.id != null)
    const skippedNoId = records.length - identified.length
    let rows = identified.map((rec) => mapTask(rec, contactIdByExternal, dealIdByExternal))
    // Zoho's list endpoint has no status filter, so the first run drops
    // completed tasks here rather than importing the whole history.
    let droppedCompleted = 0
    if (!since) {
      const open = rows.filter((r) => !r.is_completed)
      droppedCompleted = rows.length - open.length
      rows = open
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await db.from('tasks').upsert(batch, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`task upsert: ${error.message}`)
      upserted += batch.length
    }

    const summary = [
      since ? 'incremental' : 'first run (open only)',
      `fetched:${records.length} upserted:${upserted}`,
      skippedNoId ? `skipped ${skippedNoId} with no id` : '',
      droppedCompleted ? `dropped ${droppedCompleted} already-completed` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    await logSync(db, 'zoho-tasks', 'ok', upserted, summary)
    return new Response(JSON.stringify({ ok: true, upserted, fetched: records.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'zoho-tasks', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
