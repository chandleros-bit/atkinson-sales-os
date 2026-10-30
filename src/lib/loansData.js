// Supabase glue for loans. Reads return { data, error } like a bare query so
// pages can treat them the same way.
import { supabase } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { resolveRates, DEFAULT_RATES } from './loans'
import { IMPORT_FIELDS } from './ariveImport'

// Every loans column (supabase/migrations/0052_loans.sql) except `raw`, the
// whole CSV row, which no page reads and which would bloat every load.
export const LOAN_COLUMNS = [
  'id', 'arive_loan_id', 'business_id', 'loan_officer', 'role', 'borrower_name', 'borrower_first',
  'borrower_last', 'borrower_email', 'borrower_phone', 'co_borrower_name', 'co_borrower_email', 'contact_id',
  'amount', 'purpose', 'stage', 'stage_group', 'property_address', 'property_state', 'lender', 'title_company',
  'closed_on', 'funded_on', 'firm_closing_on', 'application_on', 'rate', 'loan_type', 'term_months',
  'buyer_agent_name', 'buyer_agent_company', 'buyer_agent_email', 'buyer_agent_phone', 'seller_agent_name',
  'seller_agent_company', 'seller_agent_email', 'seller_agent_phone', 'scenario_auto', 'scenario_override',
  'comp_override', 'first_imported_at', 'last_seen_at', 'updated_at',
].join(', ')

// True when the error says the table itself is missing: Postgres 42P01, or
// PostgREST PGRST205 ("Could not find the table ... in the schema cache").
// fetchAll rethrows with the message only, so the message counts too. A
// missing column ("column x does not exist") is a real bug and is not matched.
export function isMissingTable(error) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const msg = String(error.message || '')
  return /relation .* does not exist/i.test(msg) || /could not find the table/i.test(msg)
}

// { loans, rates, lastImport: { ran_at, records_upserted } | null }
// Before migration 0052 is applied, reads as "nothing imported yet".
export async function fetchLoanBundle() {
  const [loans, settings, last] = await Promise.all([
    fetchAllSettled(() => supabase.from('loans').select(LOAN_COLUMNS).order('id')),
    supabase.from('settings').select('value').eq('key', 'arive').maybeSingle(),
    supabase.from('sync_log').select('ran_at, records_upserted').eq('source', 'arive').eq('status', 'ok')
      .order('ran_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (isMissingTable(loans.error)) return { data: { loans: [], rates: DEFAULT_RATES, lastImport: null }, error: null }
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
// -> { error, warning }. The loans are saved even when only the log insert
// fails, so that comes back as a warning, not an error.
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
  const { error: logError } = await supabase.from('sync_log').insert({
    source: 'arive', ran_at: now, records_upserted: error ? 0 : payload.length, status: error ? 'error' : 'ok', message,
  })
  if (error) return { error, warning: null }
  if (logError) return { error: null, warning: `Loans saved, but the import log failed: ${logError.message}` }
  return { error: null, warning: null }
}

export function saveRates(rates) {
  return supabase.from('settings').upsert({ key: 'arive', value: rates }, { onConflict: 'key' })
}

// patch: { comp_override } and/or { scenario_override }.
export function saveLoanPatch(id, patch) {
  return supabase.from('loans').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}
