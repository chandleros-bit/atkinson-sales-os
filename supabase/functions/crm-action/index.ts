// CRM write-back (Quick Actions). Called from the browser with the signed-in
// user's JWT via supabase.functions.invoke('crm-action', { body }).
//
// Unlike the sync functions (deployed --no-verify-jwt for pg_cron), this one is
// deployed WITH JWT verification. run.ts lets ALLOWED_USER_ID (Chandler) do
// everything and a user_roles 'assistant' add notes, create follow-ups and
// complete tasks on Bayway only; anyone else gets 403.
// Setup: docs/phase-writeback-setup.md.

import { serviceClient } from '../_shared/db.ts'
import { run } from './run.ts'
import { fubAdapter, zohoAdapter } from './crm.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const db = serviceClient()
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data, error } = token ? await db.auth.getUser(token) : { data: null, error: new Error('no token') }
  const userId = data?.user?.id
  if (error || !userId) return json(401, { error: 'Not signed in' })
  // The caller's role (assistant login). A failed lookup means no role: only
  // ALLOWED_USER_ID gets through then.
  const { data: roleRow } = await db.from('user_roles').select('role').eq('user_id', userId).maybeSingle()

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Body must be JSON' })
  }

  const env = (k) => Deno.env.get(k)
  try {
    const out = await run(body, {
      db,
      adapters: { bay: fubAdapter(env), mpg: zohoAdapter(env, { db }) },
      allowedUserId: env('ALLOWED_USER_ID'),
      userId,
      role: roleRow?.role ?? null,
    })
    return json(out.http, out.body)
  } catch (e) {
    console.error('crm-action failed', e)
    return json(500, { error: String(e?.message || e) })
  }
})
