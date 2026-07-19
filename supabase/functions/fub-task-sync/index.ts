// Scheduled FollowUpBoss TASK sync. Separate from fub-sync and
// fub-activity-sync so it runs on its own cadence and logs its own sync_log
// line ('fub-tasks'). Read-only against FUB: only GETs, never writes back.
// See docs/phase-tasks-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import { fetchOpenTasks, fetchTasksUpdatedSince, mapTask } from '../_shared/fub-tasks.ts'

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    // FUB person id -> our contacts.id, and FUB deal id -> our deals.id, so
    // tasks resolve their contact and (optionally) their deal.
    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    const { data: dealMapRows } = await db
      .from('deals')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    const dealIdByExternal = new Map((dealMapRows || []).map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run. First run (no prior ok run)
    // pulls OPEN tasks only, so we never drag in the completed history.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'fub-tasks')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || null

    const records = since ? await fetchTasksUpdatedSince(since) : await fetchOpenTasks()
    // An id-less record would map to external_id "undefined" and two of them
    // would collide on unique (source_crm, external_id), silently overwriting
    // each other. Drop them and count them instead.
    const identified = records.filter((rec) => rec.id != null)
    const skippedNoId = records.length - identified.length
    let rows = identified.map((rec) => mapTask(rec, contactIdByExternal, dealIdByExternal))
    // Defensive: if FUB ignores the isCompleted filter on the first run, drop
    // completed rows here rather than importing history.
    if (!since) rows = rows.filter((r) => !r.is_completed)

    if (rows.length) {
      const { error } = await db.from('tasks').upsert(rows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`task upsert: ${error.message}`)
      upserted += rows.length
    }

    const summary = [
      since ? 'incremental' : 'first run (open only)',
      `fetched:${records.length} upserted:${upserted}`,
      skippedNoId ? `skipped ${skippedNoId} with no id` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    await logSync(db, 'fub-tasks', 'ok', upserted, summary)
    return new Response(JSON.stringify({ ok: true, upserted, fetched: records.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub-tasks', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
