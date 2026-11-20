// Power Dialer reads and writes (spec 2026-11-20). Supabase only: nothing in
// this file touches Zoho or FUB. Pure import logic is lib/dialerImport.js.
import { supabase, isDemoMode } from './supabase'
import { fetchAll } from './fetchAll'

const DNC_CHUNK = 200 // numbers per .in() lookup, keeps the URL short
const LEAD_CHUNK = 500 // rows per insert

// Lists for the Lists screen, newest first, with card counts (v_dialer_lists).
export async function fetchLists() {
  if (isDemoMode) return { data: [], error: null }
  try {
    const data = await fetchAll(() =>
      supabase.from('v_dialer_lists').select('*').order('created_at', { ascending: false }).order('id'),
    )
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

// Which of these E.164 numbers are on the shared Do Not Call list.
export async function fetchDncSet(phones) {
  const set = new Set()
  if (isDemoMode) return set
  const unique = [...new Set(phones.filter(Boolean))]
  for (let i = 0; i < unique.length; i += DNC_CHUNK) {
    // rowcap-ok: at most DNC_CHUNK rows back, one per number asked about
    const { data, error } = await supabase
      .from('dnc_numbers')
      .select('phone_e164')
      .in('phone_e164', unique.slice(i, i + DNC_CHUNK))
    if (error) throw new Error(error.message)
    for (const r of data || []) set.add(r.phone_e164)
  }
  return set
}

// Saves a list and its leads. If any lead batch fails the list is deleted
// (leads cascade), so a half-saved list never shows up.
export async function saveList({ business, temperature, name, filename, mapping, leads, scrubbedBy }) {
  if (isDemoMode) return { id: null, error: new Error('Saving needs the database (demo mode).') }
  const cold = business === 'bay' && temperature === 'cold'
  const { data: list, error } = await supabase
    .from('dialer_lists')
    .insert({
      business_id: business,
      temperature: business === 'bay' ? temperature : null,
      name,
      source_filename: filename || null,
      column_mapping: mapping,
      dnc_scrub_confirmed_by: cold ? scrubbedBy : null,
      dnc_scrub_confirmed_at: cold ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (error) return { id: null, error }

  for (let i = 0; i < leads.length; i += LEAD_CHUNK) {
    const batch = leads.slice(i, i + LEAD_CHUNK).map((l) => ({ ...l, list_id: list.id, business_id: business }))
    const { error: leadErr } = await supabase.from('dialer_leads').insert(batch)
    if (leadErr) {
      await supabase.from('dialer_lists').delete().eq('id', list.id)
      return { id: null, error: leadErr }
    }
  }
  return { id: list.id, error: null }
}
