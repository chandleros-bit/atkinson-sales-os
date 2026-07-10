// Shared Supabase client for Edge Functions.
// Uses the SERVICE ROLE key (server-side only, never shipped to the browser)
// so writes bypass the read-only RLS policies applied to the app's client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set as function secrets')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function logSync(db, source, status, records_upserted, message = null) {
  await db.from('sync_log').insert({ source, status, records_upserted, message })
}
