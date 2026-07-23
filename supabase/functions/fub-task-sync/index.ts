// Scheduled FollowUpBoss TASK sync. Separate from fub-sync and
// fub-activity-sync so it runs on its own cadence and logs its own sync_log
// line ('fub-tasks'). Read-only against FUB: only GETs, never writes back.
// See docs/phase-tasks-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import { fetchOpenTasks, fetchTasksUpdatedSince, mapTask, reconcileCompleted } from '../_shared/fub-tasks.ts'

// Re-scan window applied to the incremental cursor — see the `since` comment.
const OVERLAP_MS = 10 * 60_000
// Upsert in batches so one oversized request can't fail a whole first run.
const BATCH = 500

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    // FUB person id -> our contacts.id, and FUB deal id -> our deals.id, so
    // tasks resolve their contact and (optionally) their deal.
    // Fail loud on a map query error: an empty map silently upserts every task
    // with contact_id null, which looks like a healthy run but quietly wrecks
    // the screen's contact column.
    const { data: contactMapRows, error: contactMapErr } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    if (contactMapErr) throw new Error(`contact map: ${contactMapErr.message}`)
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    const { data: dealMapRows, error: dealMapErr } = await db
      .from('deals')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    if (dealMapErr) throw new Error(`deal map: ${dealMapErr.message}`)
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
    // sync_log.ran_at is stamped when the run FINISHES, so a task updated
    // mid-run — after its page was fetched, before the log row landed — would
    // never be seen again by a strict updatedAfter cursor. A completion lost
    // that way strands the task on the board forever. Re-scanning an overlap
    // window is free: the upsert is idempotent on (source_crm, external_id).
    const since = lastOk?.ran_at
      ? new Date(new Date(lastOk.ran_at).getTime() - OVERLAP_MS).toISOString()
      : null

    const records = since ? await fetchTasksUpdatedSince(since) : await fetchOpenTasks()
    // An id-less record would map to external_id "undefined" and two of them
    // would collide on unique (source_crm, external_id), silently overwriting
    // each other. Drop them and count them instead.
    const identified = records.filter((rec) => rec.id != null)
    const skippedNoId = records.length - identified.length
    let rows = identified.map((rec) => mapTask(rec, contactIdByExternal, dealIdByExternal))
    // Defensive: if FUB ignores the isCompleted filter on the first run, drop
    // completed rows here rather than importing history. Counted, because a
    // nonzero number here is exactly the signal that the filter was ignored.
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

    // Reconcile completions FUB didn't hand back through the incremental window.
    // Fetch the full set of currently-open FUB task ids and mark any of our
    // still-open fub rows not in that set completed, so they drop from v_tasks.
    // fetchOpenTasks -> fubGet THROWS on any non-2xx response, so a transient
    // FUB failure aborts this whole run here — before any reconciliation write —
    // and can never wrongly mark all open tasks completed. On the first run
    // `records` already IS the open-task list, so reuse it and skip a fetch.
    const openRecords = since ? await fetchOpenTasks() : records
    const openExternalIds = new Set(
      openRecords.filter((rec) => rec.id != null).map((rec) => String(rec.id)),
    )
    const { data: ourOpen, error: ourOpenErr } = await db
      .from('tasks')
      .select('id, external_id')
      .eq('source_crm', 'fub')
      .eq('is_completed', false)
    if (ourOpenErr) throw new Error(`open rows: ${ourOpenErr.message}`)

    const staleIds = reconcileCompleted(openExternalIds, ourOpen || [])
    let reconciled = 0
    if (staleIds.length > 0) {
      const { error: reapErr } = await db
        .from('tasks')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .in('id', staleIds)
      if (reapErr) throw new Error(`reconcile completed: ${reapErr.message}`)
      reconciled = staleIds.length
    }

    const summary = [
      since ? 'incremental' : 'first run (open only)',
      `fetched:${records.length} upserted:${upserted}`,
      reconciled ? `reconciled-completed:${reconciled}` : '',
      skippedNoId ? `skipped ${skippedNoId} with no id` : '',
      droppedCompleted ? `dropped ${droppedCompleted} already-completed` : '',
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
