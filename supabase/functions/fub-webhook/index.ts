// FollowUpBoss webhook receiver.
// Register this function's URL in FollowUpBoss under Admin -> API -> Webhooks
// for the "peopleUpdated" / "peopleCreated" and "dealUpdated" / "dealCreated"
// events, with ?secret=... appended (see docs/phase2-fub-setup.md).
//
// VERIFY BEFORE RELYING ON THIS: FUB's webhook payloads are "thin" - they
// notify that a resource changed and identify it, rather than including the
// full record. This handler re-fetches the resource from the API before
// upserting so it works either way, but confirm the actual field names
// (e.g. "eventId", "uri", or "personId"/"dealId") against the payload FUB
// sends to your account on first delivery, and adjust the parsing below.

import { serviceClient, logSync } from '../_shared/db.ts'
import {
  fetchPersonById,
  fetchDealById,
  mapContact,
  mapDeal,
} from '../_shared/fub.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const expected = Deno.env.get('FUB_WEBHOOK_SECRET')
  if (expected && url.searchParams.get('secret') !== expected) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = serviceClient()

  try {
    const body = await req.json()
    const event = body.event || body.type || ''
    const resourceIds = body.resourceIds || (body.personId ? [body.personId] : body.dealId ? [body.dealId] : [])

    let upserted = 0

    if (event.toLowerCase().includes('deal')) {
      for (const id of resourceIds) {
        const deal = await fetchDealById(id)
        const { data: stageMapRows } = await db
          .from('stages')
          .select('id, external_id')
          .eq('business_id', 'bay')
        const stageIdByExternal = new Map((stageMapRows || []).map((r) => [r.external_id, r.id]))
        const { data: contactMapRows } = await db
          .from('contacts')
          .select('id, external_id')
          .eq('source_crm', 'fub')
        const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

        const row = mapDeal(deal, contactIdByExternal, stageIdByExternal)
        const { error } = await db.from('deals').upsert(row, { onConflict: 'source_crm,external_id' })
        if (error) throw new Error(`deal upsert: ${error.message}`)
        upserted += 1
      }
    } else {
      for (const id of resourceIds) {
        const person = await fetchPersonById(id)
        const row = mapContact(person)
        const { error } = await db.from('contacts').upsert(row, { onConflict: 'source_crm,external_id' })
        if (error) throw new Error(`contact upsert: ${error.message}`)
        upserted += 1
      }
    }

    await logSync(db, 'fub-webhook', 'ok', upserted, `event: ${event || 'unknown'}`)
    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub-webhook', 'error', 0, String(err?.message || err))
    // Still return 200 so FUB does not disable the webhook after retries;
    // the error is visible on the Sync Status screen instead.
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
})
