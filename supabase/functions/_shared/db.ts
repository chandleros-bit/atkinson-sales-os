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

// PostgREST caps a single response at 1000 rows; page through with range().
// Needed by any read against a table that only grows — nothing in this schema
// is hard-deleted, so 'contacts', 'activities', 'borrower_doc_tracking', and
// 'borrower_docs' all cross 1000 rows eventually. A truncated read past the
// cap does not error: it just silently returns a partial result, which is far
// worse than a query that fails loudly. Do not simplify this back to a bare
// .select().
export async function fetchAll(makeQuery) {
  const pageSize = 1000
  let from = 0
  const rows = []
  while (true) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows
}
