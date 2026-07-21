// Scheduled Google Sheets -> borrower docs sync. Read-only against the sheet:
// only GETs, and the service account is shared as Viewer. Logs to sync_log
// under source 'sheets-docs'. See docs/phase-borrower-docs-setup.md.
//
// Full snapshot every run (no cursor), so the cursor race that affects the FUB
// syncs cannot occur here. The hazard is the opposite one — an empty read
// looking like success — which assertNotMassRemoval handles before any write.

import { serviceClient, logSync } from '../_shared/db.ts'
import { getAccessToken } from '../_shared/google-auth.ts'
import { parseSheet } from '../_shared/sheet-docs.ts'
import { diffTracking, diffDocs, assertNotMassRemoval } from '../_shared/sheet-docs-diff.ts'

const TAB = 'Doc Status'
const BATCH = 500

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const rawCreds = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    const sheetId = Deno.env.get('DOCS_SHEET_ID')
    if (!rawCreds || !sheetId) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON / DOCS_SHEET_ID not set as function secrets')
    }

    // Auth first: a bad key must abort before we diff anything.
    const token = await getAccessToken(JSON.parse(rawCreds))
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
      `/values/${encodeURIComponent(TAB)}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`sheets read failed: ${res.status} ${await res.text()}`)
    const parsed = parseSheet(((await res.json())?.values as unknown[][]) || [])

    // Existing state. Fail loud on query errors: an empty map here would look
    // like "every borrower is new" and re-stamp every aging clock.
    const { data: trackRows, error: trackErr } = await db
      .from('borrower_doc_tracking')
      .select('id, fub_person_id, notes, removed_at')
    if (trackErr) throw new Error(`tracking read: ${trackErr.message}`)
    const existingTracking = trackRows || []

    const activeCount = existingTracking.filter((t) => !t.removed_at).length
    assertNotMassRemoval(parsed.rows.length, activeCount)

    const { data: docRows, error: docErr } = await db
      .from('borrower_docs')
      .select('tracking_id, doc_type, status, first_requested_at, received_at, removed_at')
    if (docErr) throw new Error(`docs read: ${docErr.message}`)

    const personByTrackingId = new Map(existingTracking.map((t) => [t.id, t.fub_person_id]))
    const existingDocsByPerson = new Map()
    for (const d of docRows || []) {
      const person = personByTrackingId.get(d.tracking_id)
      if (!person) continue
      if (!existingDocsByPerson.has(person)) existingDocsByPerson.set(person, [])
      existingDocsByPerson.get(person).push(d)
    }

    const nowIso = new Date().toISOString()

    // Contact resolution. Same fail-loud rule: an empty map would upsert every
    // borrower with contact_id null while logging ok.
    const { data: contactRows, error: contactErr } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    if (contactErr) throw new Error(`contact map: ${contactErr.message}`)
    const contactIdByExternal = new Map((contactRows || []).map((c) => [c.external_id, c.id]))

    // 1. Tracking rows first — doc rows need their ids.
    //
    // active and removed are upserted SEPARATELY and must never be merged into
    // one call. supabase-js builds the `columns=` param from the union of keys
    // across the batch, and PostgREST writes NULL into any column a given row
    // lacks. Merging the two shapes would silently null `last_seen_at` for every
    // dropped borrower — no error, no log line, just wrong data.
    const { active, removed } = diffTracking(parsed.rows, existingTracking, nowIso)
    const withContact = (t) => ({
      ...t,
      contact_id: contactIdByExternal.get(t.fub_person_id) ?? null,
      updated_at: nowIso,
    })

    for (const list of [active.map(withContact), removed.map(withContact)]) {
      for (let i = 0; i < list.length; i += BATCH) {
        const { error } = await db
          .from('borrower_doc_tracking')
          .upsert(list.slice(i, i + BATCH), { onConflict: 'fub_person_id' })
        if (error) throw new Error(`tracking upsert: ${error.message}`)
      }
    }
    const trackingChanges = active.length + removed.length

    // 2. Re-read ids so newly inserted borrowers resolve.
    const { data: afterRows, error: afterErr } = await db
      .from('borrower_doc_tracking')
      .select('id, fub_person_id')
    if (afterErr) throw new Error(`tracking id re-read: ${afterErr.message}`)
    const trackingIdByPerson = new Map((afterRows || []).map((t) => [t.fub_person_id, t.id]))

    // 3. Doc rows.
    const docs = diffDocs(parsed.rows, existingDocsByPerson, nowIso)
      .map((d) => {
        const { fub_person_id, ...rest } = d
        const tracking_id = trackingIdByPerson.get(fub_person_id)
        return tracking_id ? { ...rest, tracking_id, updated_at: nowIso } : null
      })
      .filter(Boolean)

    for (let i = 0; i < docs.length; i += BATCH) {
      const { error } = await db
        .from('borrower_docs')
        .upsert(docs.slice(i, i + BATCH), { onConflict: 'tracking_id,doc_type' })
      if (error) throw new Error(`docs upsert: ${error.message}`)
      upserted += Math.min(BATCH, docs.length - i)
    }

    const unresolved = parsed.rows.filter((r) => !contactIdByExternal.has(r.fub_person_id)).length
    // Samples name the offending cells so an operator can find a typo in a sheet
    // of hundreds of rows; the count stays truthful past the 10-sample cap.
    const samples = (parsed.unrecognizedSamples || [])
      .map((s) => `${s.fub_person_id}/${s.doc_type}="${s.value}"`)
      .join(', ')
    const summary = [
      `borrowers:${parsed.rows.length} (prev tracked:${activeCount}) docChanges:${docs.length} trackingChanges:${trackingChanges}`,
      parsed.skippedNoId ? `skipped ${parsed.skippedNoId} with a bad FUB ID` : '',
      parsed.skippedDuplicate ? `skipped ${parsed.skippedDuplicate} duplicate-ID rows` : '',
      parsed.skippedDuplicateHeaders
        ? `dropped ${parsed.skippedDuplicateHeaders} ambiguous duplicate doc columns`
        : '',
      parsed.unrecognizedValues
        ? `${parsed.unrecognizedValues} unrecognized cell values (${samples})`
        : '',
      unresolved ? `${unresolved} not yet matched to a contact` : '',
    ]
      .filter(Boolean)
      .join(' | ')

    await logSync(db, 'sheets-docs', 'ok', upserted, summary)
    return new Response(JSON.stringify({ ok: true, upserted, borrowers: parsed.rows.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'sheets-docs', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
