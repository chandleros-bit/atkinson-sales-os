// Scheduled FollowUpBoss sync.
// Triggered every 15 minutes by pg_cron (see docs/phase2-fub-setup.md).
// Read-only against FUB: this function only GETs from FollowUpBoss and
// writes to our own Supabase tables. It never writes back to FUB.

import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import {
  fetchPipelinesAndStages,
  fetchPeople,
  fetchDeals,
  mapStage,
  mapContact,
  mapDeal,
} from '../_shared/fub.ts'

Deno.serve(async (req) => {
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
    const people = await fetchPeople(since)
    const contactRows = people.map(mapContact)
    if (contactRows.length) {
      const { error } = await db
        .from('contacts')
        .upsert(contactRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`contact upsert: ${error.message}`)
      upserted += contactRows.length
    }

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

    await logSync(db, 'fub', 'ok', upserted)
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
})
