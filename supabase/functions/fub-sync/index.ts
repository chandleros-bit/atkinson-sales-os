// Scheduled FollowUpBoss sync.
// Triggered every 2 minutes by pg_cron (migration 0038; see docs/phase2-fub-setup.md).
// Read-only against FUB: this function only GETs from FollowUpBoss and
// writes to our own Supabase tables. It never writes back to FUB.
// Also called from the browser (Sync Status "Run FollowUpBoss sync now"), so
// it answers CORS preflight. Stays deployed --no-verify-jwt for pg_cron.

import { serviceClient, logSync, fetchAll, linkFubOrphans } from '../_shared/db.ts'
import { withCors } from '../_shared/cors.ts'
import { myFubUserId, partitionByOwner, deletedInFub } from '../_shared/fub-owner.ts'
import { backfillFirstNotes } from '../_shared/fub-first-note.ts'
import {
  fubGet,
  fetchPipelinesAndStages,
  fetchPeople,
  fetchDeals,
  mapStage,
  mapContact,
  mapDeal,
  shouldFullPeopleRefresh,
} from '../_shared/fub.ts'

Deno.serve(withCors(async (req) => {
  const db = serviceClient()
  let upserted = 0

  try {
    // 1. Stages first, so deals can resolve stage_id on insert.
    const pipelines = await fetchPipelinesAndStages()
    const stageRows = []
    for (const pipeline of pipelines) {
      const stages = pipeline.stages || []
      stages.forEach((s, i) => stageRows.push(mapStage(s, i)))
    }
    if (stageRows.length) {
      const { error } = await db
        .from('stages')
        .upsert(stageRows, { onConflict: 'business_id,external_id' })
      if (error) throw new Error(`stage upsert: ${error.message}`)
      upserted += stageRows.length
    }

    const { data: stageMapRows } = await db
      .from('stages')
      .select('id, external_id')
      .eq('business_id', 'bay')
    const stageIdByExternal = new Map((stageMapRows || []).map((r) => [r.external_id, r.id]))

    // 2. People -> contacts. Incremental since last successful run.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'fub')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const since = lastOk?.ran_at || null
    // Hourly full pass so tag edits made in FUB reach the board (see
    // shouldFullPeopleRefresh). Deals below stay incremental.
    const fullPeople = shouldFullPeopleRefresh(Date.now(), req.url)
    const people = await fetchPeople(fullPeople ? null : since)
    // Chandler's book only (see _shared/fub-owner.ts). People fetched here but
    // assigned to another agent are removed, which also catches a lead
    // reassigned away from him since the last run.
    const myId = myFubUserId((k) => Deno.env.get(k))
    const { mine, others } = partitionByOwner(people, myId)
    const contactRows = mine.map(mapContact)
    if (contactRows.length) {
      const { error } = await db
        .from('contacts')
        .upsert(contactRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`contact upsert: ${error.message}`)
      upserted += contactRows.length
    }
    let removed = 0
    if (others.length) {
      const { data: n, error } = await db.rpc('remove_fub_contacts', {
        ext_ids: others.map((p) => String(p.id)),
      })
      if (error) throw new Error(`remove other owners' contacts: ${error.message}`)
      removed = n || 0
    }
    // Leads deleted in FUB: only a full read can tell (see deletedInFub).
    let deletedNote = null
    if (fullPeople) {
      const mirrored = await fetchAll(() => db.from('contacts').select('external_id').eq('source_crm', 'fub').order('id'))
      const gone = deletedInFub(mirrored.map((r) => r.external_id), people)
      if (gone.ids.length) {
        const { data: n, error } = await db.rpc('remove_fub_contacts', { ext_ids: gone.ids })
        if (error) throw new Error(`remove deleted contacts: ${error.message}`)
        deletedNote = `deleted in FUB: removed ${n || 0}`
      } else if (gone.skipped) {
        deletedNote = `deleted-in-FUB check skipped: ${gone.skipped}`
      }
    }
    const ownerNote = [
      fullPeople ? 'full people refresh' : 'incremental',
      myId
        ? `people: kept ${mine.length} of ${people.length} (FUB user ${myId}), removed ${removed}`
        : 'people: owner filter off (FUB_USER_ID unset)',
      deletedNote,
    ].filter(Boolean).join(' | ')

    // Paginate: past 1000 contacts a bare .select() truncates silently and
    // every deal beyond the cap resolves a null contact_id. fetchAll throws on
    // error too, so a failed map read stops the run instead of nulling links.
    let contactMapRows
    try {
      contactMapRows = await fetchAll(() =>
        db.from('contacts').select('id, external_id').eq('source_crm', 'fub'),
      )
    } catch (e) {
      throw new Error(`contact map: ${e?.message || e}`)
    }
    const contactIdByExternal = new Map(contactMapRows.map((r) => [r.external_id, r.id]))

    // 3. Deals, resolving contact_id and stage_id from the maps above.
    const deals = await fetchDeals(since)
    const dealRows = deals.map((d) => mapDeal(d, contactIdByExternal, stageIdByExternal))
    if (dealRows.length) {
      const { error } = await db
        .from('deals')
        .upsert(dealRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`deal upsert: ${error.message}`)
      upserted += dealRows.length
    }

    // New people may be the missing link for activity / tasks synced earlier.
    const linked = await linkFubOrphans(db)

    // Each lead's first note (what its source said), a few leads per run, for
    // the Workbench call rows. Never fails the sync.
    let firstNotes = ''
    try {
      const { checked, found } = await backfillFirstNotes(db, fubGet, { max: 30 })
      if (checked) firstNotes = `first notes: ${found} of ${checked}`
    } catch (e) {
      firstNotes = `first notes skipped: ${String(e?.message || e).slice(0, 120)}`
    }
    await logSync(db, 'fub', 'ok', upserted, [ownerNote, linked, firstNotes].filter(Boolean).join(' | '))
    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}))
