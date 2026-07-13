// Scheduled FollowUpBoss ACTIVITY sync (calls, texts, emails, notes,
// appointments). Separate from fub-sync so it runs on its own cadence and logs
// its own sync_log line ('fub-activity'). Read-only against FUB: only GETs,
// never writes back. See docs/phase-activity-fub-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import {
  fetchCalls,
  fetchTexts,
  fetchEmails,
  fetchNotes,
  fetchAppointments,
  mapActivity,
} from '../_shared/fub-activity.ts'

const NINETY_DAYS_MS = 90 * 86_400_000

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    // FUB person id -> our contacts.id, so activities resolve their contact.
    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run; first run is bounded to 90 days
    // so we don't pull the entire history of an 800+ contact account at once.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'fub-activity')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || new Date(Date.now() - NINETY_DAYS_MS).toISOString()

    const byType = [
      ['call', await fetchCalls(since)],
      ['text', await fetchTexts(since)],
      ['email', await fetchEmails(since)],
      ['note', await fetchNotes(since)],
      ['appointment', await fetchAppointments(since)],
    ]

    const rows = []
    for (const [type, records] of byType) {
      for (const rec of records) rows.push(mapActivity(rec, type, contactIdByExternal))
    }

    if (rows.length) {
      const { error } = await db
        .from('activities')
        .upsert(rows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`activity upsert: ${error.message}`)
      upserted += rows.length
    }

    await logSync(db, 'fub-activity', 'ok', upserted)
    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub-activity', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
