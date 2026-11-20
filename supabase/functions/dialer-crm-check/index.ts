// Power Dialer upload check (spec 2026-11-20, "Upload check"): which numbers
// on a new list are already in a CRM. READ ONLY: nothing is written to Zoho,
// FUB or the database. Called from the browser with the signed-in user's JWT
// via supabase.functions.invoke('dialer-crm-check', { body }); deployed WITH
// JWT verification, owner only.
//
// body: { business: 'mpg' | 'bay', phones: string[] (E.164) }
// ->    { matches: { [e164]: CrmMatch } }
//   bay: FUB people already synced into contacts (no live FUB calls).
//   mpg: Zoho Leads, Contacts and Accounts by COQL (see _shared/dialer-crm.ts).

import { serviceClient, fetchAll } from '../_shared/db.ts'
import { getAccessToken, zohoSend } from '../_shared/zoho.ts'
import { zohoDupQueries, matchZohoRows, matchFubContacts, wantMap } from '../_shared/dialer-crm.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MAX_PHONES = 5000

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
  const business = body?.business
  const phones = Array.isArray(body?.phones) ? body.phones.filter((p) => typeof p === 'string') : null
  if (!['mpg', 'bay'].includes(business) || !phones) return json(400, { error: 'business (mpg|bay) and phones[] are required' })
  if (phones.length > MAX_PHONES) return json(400, { error: `At most ${MAX_PHONES} numbers per check` })

  const want = wantMap(phones)
  if (!want.size) return json(200, { matches: {} })

  try {
    if (business === 'bay') {
      const contacts = await fetchAll(() =>
        db
          .from('contacts')
          .select('id, external_id, name, owner, phone, phones:raw->phones')
          .eq('business_id', 'bay')
          .eq('source_crm', 'fub')
          .order('id'),
      )
      return json(200, { matches: matchFubContacts(contacts, want) })
    }

    const { apiHost, accessToken } = await getAccessToken({ db })
    const matches = {}
    for (const { module, query } of zohoDupQueries([...want.values()])) {
      const res = await zohoSend(apiHost, accessToken, 'POST', 'coql', { select_query: query })
      // A 2xx body that is an error must not read as "no matches". Only an
      // empty body (204) means no rows.
      if (res && (res.code || res.message || String(res.status).toLowerCase() === 'error')) {
        throw new Error(`Zoho COQL ${module} -> ${res.code || 'ERROR'}: ${res.message || 'query rejected'}`)
      }
      matchZohoRows(module, res?.data || [], want, matches)
    }
    return json(200, { matches })
  } catch (e) {
    console.error('dialer-crm-check failed', e)
    return json(502, { error: String(e?.message || e) })
  }
})
