// Supabase calls for the MPG touch log (migration 0060). App-owned, per user:
// RLS limits every query to your own rows. Pure logic lives in mpgTracker.js.
import { supabase, isDemoMode } from './supabase'
import { cleanQuery } from './search'
import { dayRange } from './mpgTracker'

// MPG businesses matching q: Zoho contacts (by person or company) and OS
// prospects not yet promoted. -> [{ type, id, name, sub, phone, email, role }]
export async function searchMpgBusinesses(q) {
  const s = cleanQuery(q)
  if (s.length < 2 || isDemoMode) return []
  const [contacts, prospects] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, company, phone, email')
      .eq('business_id', 'mpg')
      .or(`name.ilike.%${s}%,company.ilike.%${s}%`)
      .order('company')
      .limit(8),
    supabase
      .from('mpg_prospects')
      .select('id, business_name, contact_name, contact_role, phone, email')
      .neq('status', 'promoted')
      .ilike('business_name', `%${s}%`)
      .order('business_name')
      .limit(8),
  ])
  return [
    ...(contacts.data || []).map((c) => ({
      type: 'contact', id: c.id, name: c.company || c.name, sub: c.company ? c.name : 'Zoho lead',
      phone: c.phone, email: c.email, role: null, contactName: c.company ? c.name : null,
    })),
    ...(prospects.data || []).map((p) => ({
      type: 'prospect', id: p.id, name: p.business_name, sub: p.contact_name || 'Not in Zoho',
      phone: p.phone, email: p.email, role: p.contact_role, contactName: p.contact_name,
    })),
  ]
}

// { prospect, touch } from buildVisit -> the saved touch. A new business's
// prospect is inserted first so the touch can point at it.
export async function saveVisit({ prospect, touch }) {
  let row = touch
  if (prospect) {
    const { data, error } = await supabase.from('mpg_prospects').insert(prospect).select('id').single()
    if (error) return { data: null, error }
    row = { ...touch, prospect_id: data.id }
  }
  if (!row.prospect_id && !row.contact_id) return { data: null, error: { message: 'A visit needs a business' } }
  const res = await supabase.from('mpg_touches').insert(row).select('*').single()
  // A new prospect was inserted but the touch failed: hand back its id so a
  // retried Save reuses it instead of inserting a duplicate.
  if (res.error && prospect) return { data: null, error: res.error, prospectId: row.prospect_id }
  return res
}

export async function updateTouch(id, patch) {
  return supabase.from('mpg_touches').update(patch).eq('id', id).select('*').single()
}

export async function deleteTouch(id) {
  return supabase.from('mpg_touches').delete().eq('id', id)
}

// One local day's touches of a channel, oldest first.
export async function fetchTouchesForDay(dayKey, channel = 'walk_in') {
  if (isDemoMode) return { data: [], error: null }
  const { from, to } = dayRange(dayKey)
  return supabase
    .from('mpg_touches')
    .select('*')
    .eq('channel', channel)
    .gte('occurred_at', from)
    .lt('occurred_at', to)
    .order('occurred_at', { ascending: true })
}

// Lets the Daily tracker reload after a visit is saved, edited or deleted.
const CHANGED = 'mpg-touches:changed'
export function notifyTouchesChanged() {
  window.dispatchEvent(new CustomEvent(CHANGED))
}
export function onTouchesChanged(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}
