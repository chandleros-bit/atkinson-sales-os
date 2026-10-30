// Supabase glue for loans. Reads return { data, error } like a bare query so
// pages can treat them the same way.
import { supabase } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { resolveRates } from './loans'
import { IMPORT_FIELDS } from './ariveImport'

// { loans, rates, lastImport: { ran_at, records_upserted } | null }
export async function fetchLoanBundle() {
  const [loans, settings, last] = await Promise.all([
    fetchAllSettled(() => supabase.from('loans').select('*').order('id')),
    supabase.from('settings').select('value').eq('key', 'arive').maybeSingle(),
    supabase.from('sync_log').select('ran_at, records_upserted').eq('source', 'arive').eq('status', 'ok')
      .order('ran_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const error = loans.error || settings.error || last.error
  if (error) return { data: null, error }
  return {
    data: { loans: loans.data || [], rates: resolveRates(settings.data?.value), lastImport: last.data || null },
    error: null,
  }
}

// Bayway contacts for matching, only needed while importing.
export function fetchBayContacts() {
  return fetchAllSettled(() => supabase.from('contacts').select('id, name, email, phone').eq('business_id', 'bay').order('id'))
}

// Upserts the preview's loans (import-owned columns only) and logs the import.
export async function saveImport(preview) {
  const now = new Date().toISOString()
  const payload = preview.loans.map((l) => ({
    arive_loan_id: l.arive_loan_id,
    ...Object.fromEntries(IMPORT_FIELDS.map((f) => [f, l[f] ?? null])),
    raw: l.raw,
    last_seen_at: now,
    updated_at: now,
  }))
  const { error } = await supabase.from('loans').upsert(payload, { onConflict: 'arive_loan_id' })
  const c = preview.counts
  const message = error
    ? error.message
    : `${c.new} new, ${c.updated} updated, ${c.unchanged} unchanged, ${c.scenario} scenario, ${c.unmatched} unmatched, ${c.missing} not in file`
  await supabase.from('sync_log').insert({
    source: 'arive', ran_at: now, records_upserted: error ? 0 : payload.length, status: error ? 'error' : 'ok', message,
  })
  return { error }
}

export function saveRates(rates) {
  return supabase.from('settings').upsert({ key: 'arive', value: rates }, { onConflict: 'key' })
}

// patch: { comp_override } and/or { scenario_override }.
export function saveLoanPatch(id, patch) {
  return supabase.from('loans').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}
