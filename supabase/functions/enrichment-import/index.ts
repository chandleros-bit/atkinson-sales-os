// Database Opportunity Agent: enrichment import (spec build step 4).
// Called from the browser with Chandler's JWT:
//   supabase.functions.invoke('enrichment-import', { body: { source, csv, market_value_year } })
// `csv` is a filled-in past_client_match_file.csv (title rep or county match).
//
// High-confidence rows are merged into past_client_property (never over a
// manual row). Medium rows go to enrichment_review for Chandler to accept or
// reject. Low rows are counted and dropped. Nothing is written to FUB here:
// the push to the FUB custom fields goes through crm_actions after Chandler
// approves the batch (next build step), and only while writeback_enabled is on.
// Deployed WITH JWT verification. Owner only (ALLOWED_USER_ID).

import { serviceClient, logSync } from '../_shared/db.ts'
import { parseCsv, mapRow, mergeProperty, type Source } from '../_shared/enrichment.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const SOURCES: Source[] = ['arive', 'title_rep', 'hcad', 'fbcad', 'mcad', 'paid', 'manual']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const db = serviceClient()
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data } = token ? await db.auth.getUser(token) : { data: null }
  if (!data?.user?.id) return json(401, { error: 'Not signed in' })
  if (data.user.id !== Deno.env.get('ALLOWED_USER_ID')) return json(403, { error: 'Owner only' })

  let body: { source?: Source; csv?: string; market_value_year?: number }
  try { body = await req.json() } catch { return json(400, { error: 'Body must be JSON' }) }
  const source = body.source
  if (!source || !SOURCES.includes(source)) return json(400, { error: `source must be one of ${SOURCES.join(', ')}` })
  if (!body.csv) return json(400, { error: 'csv is required' })

  try {
    const mapped = parseCsv(body.csv)
      .map((r) => mapRow(r, { marketValueYear: body.market_value_year }))
      .filter((m) => m != null)
    const fubIds = [...new Set(mapped.map((m) => m!.fubId))]

    const contactByFub = new Map<string, string>()
    for (let i = 0; i < fubIds.length; i += 300) {
      const { data: rows, error } = await db.from('contacts').select('id, external_id')
        .eq('business_id', 'bay').eq('source_crm', 'fub').in('external_id', fubIds.slice(i, i + 300))
      if (error) throw new Error(`contacts read: ${error.message}`)
      for (const c of rows ?? []) contactByFub.set(String(c.external_id), c.id)
    }
    const contactIds = [...contactByFub.values()]
    const existing = new Map<string, Record<string, unknown>>()
    for (let i = 0; i < contactIds.length; i += 300) {
      const { data: rows, error } = await db.from('past_client_property').select('*')
        .in('contact_id', contactIds.slice(i, i + 300))
      if (error) throw new Error(`past_client_property read: ${error.message}`)
      for (const r of rows ?? []) existing.set(r.contact_id, r)
    }

    const counts = { accepted: 0, review: 0, dropped: 0, manual_kept: 0, unknown_contact: 0 }
    const upserts: Record<string, unknown>[] = []
    const reviews: Record<string, unknown>[] = []
    for (const m of mapped) {
      const contactId = contactByFub.get(m!.fubId)
      if (!contactId) { counts.unknown_contact++; continue }
      if (!m!.property || m!.confidence === 'low') { counts.dropped++; continue }
      if (m!.confidence === 'medium') {
        reviews.push({ contact_id: contactId, confidence: 'medium',
          candidate: { ...m!.property, source, note: m!.note } })
        counts.review++
        continue
      }
      const merged = mergeProperty((existing.get(contactId) as never) ?? null, m!.property, source, 'high')
      if (!merged) { counts.manual_kept++; continue }
      upserts.push({ ...merged, contact_id: contactId, updated_at: new Date().toISOString() })
      counts.accepted++
    }

    for (let i = 0; i < upserts.length; i += 500) {
      const { error } = await db.from('past_client_property').upsert(upserts.slice(i, i + 500), { onConflict: 'contact_id' })
      if (error) throw new Error(`past_client_property write: ${error.message}`)
    }
    if (reviews.length) {
      // One pending review per contact: replace any older pending candidate.
      const ids = [...new Set(reviews.map((r) => r.contact_id as string))]
      for (let i = 0; i < ids.length; i += 300) {
        await db.from('enrichment_review').delete().eq('decision', 'pending').in('contact_id', ids.slice(i, i + 300))
      }
      const { error } = await db.from('enrichment_review').insert(reviews)
      if (error) throw new Error(`enrichment_review write: ${error.message}`)
    }

    const summary = `${source}: ${counts.accepted} accepted, ${counts.review} to review, ${counts.dropped} dropped, ${counts.manual_kept} manual kept, ${counts.unknown_contact} unknown`
    await logSync(db, 'enrichment-import', 'ok', counts.accepted, summary)
    return json(200, { ok: true, ...counts })
  } catch (err) {
    await logSync(db, 'enrichment-import', 'error', 0, String((err as Error)?.message || err))
    return json(500, { ok: false, error: String((err as Error)?.message || err) })
  }
})
