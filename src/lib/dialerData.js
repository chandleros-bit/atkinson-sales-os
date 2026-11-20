// Power Dialer reads and writes (spec 2026-11-20). Supabase only: nothing in
// this file touches Zoho or FUB. Pure import logic is lib/dialerImport.js.
import { supabase, isDemoMode } from './supabase'
import { fetchAll } from './fetchAll'

// Demo mode (no database): one sample list so the screens can be previewed.
// Writes are no-ops there.
const DEMO_LIST = {
  id: 'demo-list', business_id: 'mpg', temperature: null, name: 'Sample: Houston cafes', status: 'active',
  dialable: 3, worked: 0, confirmed: 0, last_dialed_at: null, created_at: '2026-11-20T15:00:00Z',
}
const DEMO_LEADS = [
  ['Jane', 'Smith', 'Acme Cafe', '+17135550101', 'Houston', { 'Year Built': '1999' }],
  ['Bob', 'Jones', 'Bob Tacos', '+17135550102', 'Katy', {}],
  ['Ann', 'Lee', 'Lee Nails', '+17135550103', 'Sugar Land', {}],
].map(([first_name, last_name, company, phone_e164, city, extra], i) => ({
  id: `demo-lead-${i + 1}`, list_id: 'demo-list', business_id: 'mpg', first_name, last_name, company, phone_e164,
  phone_raw: phone_e164, city, state: 'TX', extra, status: 'queued', attempt_count: 0, position: i + 1,
}))
const DEMO_SCRIPT = {
  business_id: 'mpg', max_attempts: 3, min_retry_hours: 4,
  body: '# MPG call script\n\n- Opener: Hi, is this the owner of {company}?\n- Ask: a 10 minute statement review.',
}

const DNC_CHUNK = 200 // numbers per .in() lookup, keeps the URL short
const LEAD_CHUNK = 500 // rows per insert

// Lists for the Lists screen, newest first, with card counts (v_dialer_lists).
export async function fetchLists() {
  if (isDemoMode) return { data: [DEMO_LIST], error: null }
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

// ------------------------------------------------------------------ dial screen

// Everything the dial screen needs for one list: the list card, its open leads
// (queued and retry, CSV order), past calls on the list (for notes), the
// business's script and settings, today's numbers and the daily targets.
export async function fetchDialData(listId, today) {
  if (isDemoMode) {
    return {
      data: { list: DEMO_LIST, leads: DEMO_LEADS.map((l) => ({ ...l })), calls: [], script: DEMO_SCRIPT, today: { calls: 12 }, targetsValue: null },
      error: null,
    }
  }
  try {
    const { data: list, error: listErr } = await supabase.from('v_dialer_lists').select('*').eq('id', listId).maybeSingle()
    if (listErr) throw new Error(listErr.message)
    if (!list) throw new Error('List not found.')
    const [leads, calls, script, metrics, targets] = await Promise.all([
      fetchAll(() =>
        supabase.from('dialer_leads').select('*').eq('list_id', listId).in('status', ['queued', 'retry']).order('position').order('id'),
      ),
      fetchAll(() =>
        supabase.from('dialer_calls').select('lead_id, outcome, notes, dialed_at').eq('list_id', listId).order('dialed_at').order('id'),
      ),
      supabase.from('dialer_scripts').select('*').eq('business_id', list.business_id).maybeSingle(),
      // rowcap-ok: one business, one day, two metric keys
      supabase.from('metrics_daily').select('metric_key, value').eq('business_id', list.business_id).eq('date', today)
        .in('metric_key', ['calls', 'live_conversations']),
      supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
    ])
    for (const r of [script, metrics, targets]) if (r.error) throw new Error(r.error.message)
    const todayNums = Object.fromEntries((metrics.data || []).map((m) => [m.metric_key, Number(m.value) || 0]))
    return {
      data: { list, leads, calls, script: script.data, today: todayNums, targetsValue: targets.data?.value ?? null },
      error: null,
    }
  } catch (error) {
    return { data: null, error }
  }
}

export async function startSession(business, listId) {
  if (isDemoMode) return { id: 'demo-session', error: null }
  const { data, error } = await supabase.from('dialer_sessions').insert({ business_id: business, list_id: listId }).select('id').single()
  return { id: data?.id ?? null, error }
}

export async function endSession(id) {
  if (!id || isDemoMode) return
  await supabase.from('dialer_sessions').update({ ended_at: new Date().toISOString() }).eq('id', id)
}

// Call tapped: one dial, counted toward today's calls by the 0073 trigger.
export async function logDial({ lead, sessionId }) {
  if (isDemoMode) return { call: { id: `demo-call-${Date.now()}`, dialed_at: new Date().toISOString() }, error: null }
  const { data, error } = await supabase
    .from('dialer_calls')
    .insert({ lead_id: lead.id, list_id: lead.list_id, session_id: sessionId, business_id: lead.business_id, phone_e164: lead.phone_e164 })
    .select('id, dialed_at')
    .single()
  return { call: data, error }
}

// Outcome logged: the call row, the lead's status, and the side effects the
// outcome carries (DNC list, Ready to Push row). update: from applyOutcome.
export async function logOutcome({ callId, lead, outcomeKey, notes, callbackAt, update, pushTarget }) {
  if (isDemoMode) return { error: null }
  const done = async (q) => {
    const { error } = await q
    if (error) throw new Error(error.message)
  }
  try {
    await done(
      supabase.from('dialer_calls').update({
        outcome: outcomeKey, notes: notes || null, callback_at: callbackAt || null, logged_at: new Date().toISOString(),
      }).eq('id', callId),
    )
    await done(supabase.from('dialer_leads').update(update).eq('id', lead.id))
    if (outcomeKey === 'do_not_call') {
      await done(supabase.from('dnc_numbers').upsert(
        { phone_e164: lead.phone_e164, source: 'dialer', reason: notes || null },
        { onConflict: 'phone_e164', ignoreDuplicates: true },
      ))
      // The same number on any other open lead of this user is blocked too.
      await done(supabase.from('dialer_leads').update({ status: 'dnc', next_attempt_at: null })
        .eq('phone_e164', lead.phone_e164).in('status', ['queued', 'retry']))
    }
    if (pushTarget) {
      await done(supabase.from('dialer_push_queue').upsert(
        { lead_id: lead.id, business_id: lead.business_id, target: pushTarget, outcome: outcomeKey, status: 'pending' },
        { onConflict: 'lead_id' },
      ))
    }
    return { error: null }
  } catch (error) {
    return { error }
  }
}
