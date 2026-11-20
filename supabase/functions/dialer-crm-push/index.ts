// Power Dialer push on approval (spec 2026-11-20, "Push on approval"). The
// ONLY place the dialer writes to Zoho or FUB, and only for Ready to Push rows
// Chandler approved. Called from the browser with the signed-in user's JWT via
// supabase.functions.invoke('dialer-crm-push', { body: { ids } }); deployed
// WITH JWT verification, owner only.
//
// Per row: re-run the duplicate check for that one number (time has passed
// since upload), then
//   MPG:    existing Zoho record -> add the call-history Note to it;
//           otherwise create the Lead (dialer-push.ts) and add the Note.
//   Bayway: existing FUB person (live lookup by phone) -> add the dialer tags
//           (stage forward only) and the Note; otherwise POST /v1/people
//           (not /v1/events: no Lead Flow, no automations) and the Note.
// Success: row pushed + crm_record_id, lead pushed. Failure: row failed with
// the error and a Slack message to that business's alerts channel. A retry is
// safe: the re-check finds what a half-finished run created.

import { serviceClient } from '../_shared/db.ts'
import { getAccessToken, zohoSend } from '../_shared/zoho.ts'
import { fubGet, fubSend } from '../_shared/fub.ts'
import { buildZohoNote, zohoCreatedId } from '../_shared/zoho-write.ts'
import { buildFubNote } from '../_shared/fub-write.ts'
import { zohoDupQueries, matchZohoRows, wantMap, tenDigits } from '../_shared/dialer-crm.ts'
import { pushFields, buildZohoDialerLead, buildFubDialerPerson, fubTagsForExisting, callHistoryNote, FUB_SOURCE } from '../_shared/dialer-push.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MAX_IDS = 100
const PUSHABLE = ['pending', 'approved', 'failed']

async function zohoExisting(zoho, phone) {
  const want = wantMap([phone])
  const matches = {}
  for (const { module, query } of zohoDupQueries([phone])) {
    const res = await zoho('POST', 'coql', { select_query: query })
    if (res && (res.code || res.message || String(res.status).toLowerCase() === 'error')) {
      throw new Error(`Zoho COQL ${module} -> ${res.code || 'ERROR'}: ${res.message || 'query rejected'}`)
    }
    matchZohoRows(module, res?.data || [], want, matches)
  }
  return matches[phone] || null
}

async function pushMpg({ zoho, fields, note, listName, phone }) {
  const found = await zohoExisting(zoho, phone)
  let module = 'Leads'
  let id
  if (found) {
    module = found.module
    id = found.id
  } else {
    id = zohoCreatedId(await zoho('POST', 'Leads', buildZohoDialerLead(fields, { listName })))
  }
  await zoho('POST', `${module}/${id}/Notes`, buildZohoNote({ title: note.title, body: note.body }))
  return { id, existing: !!found, module }
}

async function pushBay({ fields, note, outcome, temperature, phone }) {
  const digits = tenDigits(phone)
  const found = digits ? (await fubGet('/people', { phone: digits, limit: 1 }))?.people?.[0] : null
  let person = found
  if (!person) {
    const body = buildFubDialerPerson(fields, { outcome, temperature, assignedUserId: Deno.env.get('FUB_USER_ID') })
    // deduplicate=true: if FUB finds the person after all, it returns them
    // unchanged instead of creating a second one.
    person = await fubSend('POST', '/people?deduplicate=true', body)
    if (!person?.id) throw new Error(`FUB POST /people returned no id: ${JSON.stringify(person).slice(0, 200)}`)
  }
  const isNew = !found && person.source === FUB_SOURCE
  if (!isNew) {
    const tags = fubTagsForExisting(person.tags || [], person.stage || null, { outcome, temperature })
    await fubSend('PUT', `/people/${person.id}`, { tags })
  }
  await fubSend('POST', '/notes', buildFubNote({ personId: person.id, subject: note.title, body: note.body }))
  return { id: String(person.id), existing: !isNew, module: 'People' }
}

async function slackFailure(business, text) {
  const url = Deno.env.get(business === 'mpg' ? 'SLACK_WEBHOOK_MPG' : 'SLACK_WEBHOOK_BAY')
  if (!url) return
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
  } catch (e) {
    console.error('slack post failed', e)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const db = serviceClient()
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data, error } = token ? await db.auth.getUser(token) : { data: null, error: new Error('no token') }
  const userId = data?.user?.id
  if (error || !userId) return json(401, { error: 'Not signed in' })
  const { data: roleRow } = await db.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
  if (roleRow?.role !== 'owner' && userId !== Deno.env.get('ALLOWED_USER_ID')) return json(403, { error: 'Owner only' })

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Body must be JSON' })
  }
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string'))] : []
  if (!ids.length || ids.length > MAX_IDS) return json(400, { error: `ids: 1 to ${MAX_IDS} queue row ids` })

  let zohoSession = null
  const zoho = async (method, path, payload) => {
    zohoSession ??= await getAccessToken({ db })
    return zohoSend(zohoSession.apiHost, zohoSession.accessToken, method, path, payload)
  }

  const results = []
  for (const id of ids) {
    const { data: row } = await db.from('dialer_push_queue').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
    if (!row) { results.push({ id, status: 'missing' }); continue }
    if (!PUSHABLE.includes(row.status)) { results.push({ id, status: row.status }); continue }
    let lead = null
    try {
      await db.from('dialer_push_queue').update({ status: 'approved', approved_at: new Date().toISOString(), error: null }).eq('id', id)
      const { data: l, error: le } = await db.from('dialer_leads').select('*').eq('id', row.lead_id).single()
      if (le) throw new Error(`lead read: ${le.message}`)
      lead = l
      const { data: list } = await db.from('dialer_lists').select('name, temperature').eq('id', lead.list_id).maybeSingle()
      const { data: calls, error: ce } = await db
        .from('dialer_calls').select('outcome, notes, dialed_at, callback_at').eq('lead_id', lead.id).order('dialed_at').limit(50)
      if (ce) throw new Error(`calls read: ${ce.message}`)
      const fields = pushFields(lead, row.payload?.fields || {})
      const note = callHistoryNote(calls || [], { listName: list?.name || '' })
      const phone = lead.phone_e164
      const out = row.business_id === 'mpg'
        ? await pushMpg({ zoho, fields, note, listName: list?.name || '', phone })
        : await pushBay({ fields, note, outcome: row.outcome, temperature: list?.temperature || null, phone })
      const now = new Date().toISOString()
      await db.from('dialer_push_queue').update({ status: 'pushed', crm_record_id: out.id, pushed_at: now, error: null }).eq('id', id)
      await db.from('dialer_leads').update({ status: 'pushed' }).eq('id', lead.id)
      results.push({ id, status: 'pushed', crm_record_id: out.id, existing: out.existing, module: out.module })
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 1000)
      await db.from('dialer_push_queue').update({ status: 'failed', error: msg }).eq('id', id)
      const who = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company || lead.phone_e164 : row.lead_id
      await slackFailure(row.business_id, `:warning: Power Dialer push to ${row.business_id === 'mpg' ? 'Zoho' : 'FUB'} failed for ${who}: ${msg.slice(0, 300)}`)
      results.push({ id, status: 'failed', error: msg })
    }
  }
  return json(200, { results })
})
