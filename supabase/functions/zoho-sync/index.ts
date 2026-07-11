// Scheduled Zoho CRM (MPG) sync.
// Triggered every 15 minutes by pg_cron (see docs/phase5-zoho-setup.md).
// Read-only against Zoho: only GETs from Zoho, writes to our own Supabase tables.

import { serviceClient, logSync } from '../_shared/db.ts'
import {
  getAccessToken,
  fetchDealStages,
  fetchLeads,
  fetchContacts,
  fetchDeals,
  mapStage,
  mapContact,
  mapDeal,
} from '../_shared/zoho.ts'

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const { accessToken, apiHost } = await getAccessToken()

    // 1. Deal stages first, so deals can resolve stage_id on insert.
    const stages = await fetchDealStages(apiHost, accessToken)
    const stageRows = stages.map((s, i) => mapStage(s, i))
    if (stageRows.length) {
      const { error } = await db
        .from('stages')
        .upsert(stageRows, { onConflict: 'business_id,external_id' })
      if (error) throw new Error(`stage upsert: ${error.message}`)
      upserted += stageRows.length
    }

    const { data: stageMapRows } = await db
      .from('stages')
      .select('id, external_id, is_won, is_lost')
      .eq('business_id', 'mpg')
    const stageIndex = new Map(
      (stageMapRows || []).map((r) => [
        r.external_id,
        { id: r.id, status: r.is_won ? 'won' : r.is_lost ? 'lost' : 'open' },
      ]),
    )

    // 2. Incremental since the last successful zoho run.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'zoho')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || null

    // 3. Leads + Contacts -> contacts.
    const [leads, contacts] = await Promise.all([
      fetchLeads(apiHost, accessToken, since),
      fetchContacts(apiHost, accessToken, since),
    ])
    const contactRows = [
      ...leads.map((r) => mapContact(r, 'Leads')),
      ...contacts.map((r) => mapContact(r, 'Contacts')),
    ]
    if (contactRows.length) {
      const { error } = await db
        .from('contacts')
        .upsert(contactRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`contact upsert: ${error.message}`)
      upserted += contactRows.length
    }

    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'zoho')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    // 4. Deals, resolving contact_id and stage_id.
    const deals = await fetchDeals(apiHost, accessToken, since)
    const dealRows = deals.map((d) => mapDeal(d, contactIdByExternal, stageIndex))
    if (dealRows.length) {
      const { error } = await db
        .from('deals')
        .upsert(dealRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`deal upsert: ${error.message}`)
      upserted += dealRows.length
    }

    await logSync(db, 'zoho', 'ok', upserted)
    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'zoho', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
