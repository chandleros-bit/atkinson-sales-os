// Database Opportunity Agent, browser side (spec "Edge functions, schedule,
// UI and Slack"). Pure outcome planning plus the Supabase reads and writes the
// Opportunities page uses. Owner only (RLS on the opportunity tables).
//
// Logging an outcome reuses the Quick Actions write-back path: one add_note
// through crm-action with a fresh client_action_id, so a double tap never
// writes twice, and nothing goes to FUB while writeback_enabled is off for
// Bayway. No answer also creates a Sales OS task (work_items), never a FUB or
// TickTick task.
import { supabase, isDemoMode } from './supabase'
import { invokeCrmAction, loadWritebackFlags } from './writeback'

export const OUTCOMES = [
  { key: 'connected', label: 'Connected' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'skipped', label: 'Skip' },
  { key: 'not_a_fit', label: 'Not a fit' },
]

const NOTE_TITLE = {
  connected: 'Mortgage review call, connected',
  no_answer: 'Mortgage review call, no answer',
  skipped: 'Mortgage review, skipped',
  not_a_fit: 'Mortgage review, not a fit',
}

export const REASON_LABEL = {
  RATE_GAP_HIGH: 'Rate gap 1+ pt',
  RATE_GAP: 'Rate gap',
  EQUITY_100K: 'Equity $100k+',
  EQUITY_50K: 'Equity $50k+',
  PMI_LIKELY_REMOVABLE: 'PMI removal',
  INVESTOR: 'Investor',
  MOVE_UP_WINDOW: 'Move-up window',
  ANNIVERSARY: 'Anniversary',
  RECENT_ENGAGEMENT: 'Engaged recently',
  KNOWN_ARM: 'ARM',
}

// YYYY-MM-DD plus n business days (Saturday and Sunday skipped).
export function addBusinessDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left -= 1
  }
  return d.toISOString().slice(0, 10)
}

export function centralToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
}

// What one outcome does: exactly one FUB note, a Sales OS task only on No
// answer, and the pick's new status.
export function planOutcome({ pick, outcome, note, today, firstName, clientActionId }) {
  if (!NOTE_TITLE[outcome]) throw new Error(`Unknown outcome: ${outcome}`)
  const text = (note || '').trim()
  const crmRequest = {
    client_action_id: clientActionId,
    action: 'add_note',
    contact_id: pick.contact_id,
    payload: { subject: NOTE_TITLE[outcome], body: text ? `${NOTE_TITLE[outcome]}. ${text}` : NOTE_TITLE[outcome] },
  }
  const workItem =
    outcome === 'no_answer'
      ? {
          business_id: 'bay',
          kind: 'custom',
          contact_id: pick.contact_id,
          title: pick.ai_note?.fub_task || `CA: Mortgage review follow-up${firstName ? ` with ${firstName}` : ''}`,
          status: 'open',
          due_on: addBusinessDays(today, 2),
        }
      : null
  return { crmRequest, workItem, patch: { status: outcome, outcome_note: text || null } }
}

// A pick left pending for 3 business days drops off Today (History keeps it).
export function isStale(pick, today) {
  return pick.status === 'pending' && addBusinessDays(pick.pick_date, 3) <= today
}

const PICK_COLS =
  'id, pick_date, contact_id, rank, score, kind, reason_codes, ai_note, status, outcome_note, crm_action_id, created_at, contacts(id, name, phone, external_id, raw)'

export async function loadPicks({ since } = {}) {
  if (isDemoMode) return []
  // Newest 500 picks: about 20 weeks at 5 a day, 15 on Wednesday.
  const { data, error } = await supabase
    .from('opportunity_picks')
    .select(PICK_COLS)
    .gte('pick_date', since || '2000-01-01')
    .order('pick_date', { ascending: false })
    .order('rank')
    .limit(500)
  if (error) throw error
  return data || []
}

export async function loadEstimates(contactIds) {
  if (isDemoMode || !contactIds.length) return new Map()
  const [est, prop] = await Promise.all([
    supabase.from('opportunity_estimates').select('*').in('contact_id', contactIds).limit(contactIds.length),
    supabase.from('past_client_property').select('*').in('contact_id', contactIds).limit(contactIds.length),
  ])
  if (est.error) throw est.error
  if (prop.error) throw prop.error
  const m = new Map()
  for (const id of contactIds) m.set(id, { estimate: null, property: null })
  for (const e of est.data || []) m.get(e.contact_id).estimate = e
  for (const p of prop.data || []) m.get(p.contact_id).property = p
  return m
}

export async function logOutcome(pick, outcome, note) {
  if (pick.status !== 'pending') return { ok: false, error: 'Already logged' }
  const today = centralToday()
  const clientActionId = crypto.randomUUID()
  const firstName = pick.contacts?.raw?.firstName || (pick.contacts?.name || '').split(' ')[0]
  const plan = planOutcome({ pick, outcome, note, today, firstName, clientActionId })

  const flags = await loadWritebackFlags()
  let crmActionId = null
  let fub = 'off'
  if (flags.bay) {
    const res = await invokeCrmAction(plan.crmRequest)
    if (res?.status !== 'ok') return { ok: false, error: res?.error || 'FUB note failed' }
    const { data } = await supabase.from('crm_actions').select('id').eq('client_action_id', clientActionId).maybeSingle()
    crmActionId = data?.id || null
    fub = 'ok'
  }
  if (plan.workItem) {
    const { error } = await supabase.from('work_items').insert(plan.workItem)
    if (error) return { ok: false, error: error.message }
  }
  const { error } = await supabase
    .from('opportunity_picks')
    .update({ ...plan.patch, crm_action_id: crmActionId })
    .eq('id', pick.id)
    .eq('status', 'pending')
  if (error) return { ok: false, error: error.message }
  return { ok: true, fub }
}

export async function loadReviews() {
  if (isDemoMode) return []
  const { data, error } = await supabase
    .from('enrichment_review')
    .select('id, contact_id, candidate, confidence, decision, created_at, contacts(id, name, raw)')
    .eq('decision', 'pending')
    .order('created_at')
    .limit(300)
  if (error) throw error
  return data || []
}

const PROPERTY_KEYS = ['address', 'city', 'state', 'zip', 'county', 'recording_date', 'sale_price', 'orig_loan_amount',
  'lender', 'market_value', 'market_value_year', 'homestead', 'kept_prior_home']

// Accepting writes the candidate as the contact's property (never over a row
// Chandler typed by hand); rejecting just records the decision.
export async function decideReview(review, decision) {
  const at = new Date().toISOString()
  if (decision === 'accept') {
    const { data: existing } = await supabase.from('past_client_property').select('is_manual').eq('contact_id', review.contact_id).maybeSingle()
    if (!existing?.is_manual) {
      const c = review.candidate || {}
      const row = { contact_id: review.contact_id, source: c.source || 'manual', confidence: 'medium', is_manual: false, updated_at: at }
      for (const k of PROPERTY_KEYS) if (k in c) row[k] = c[k]
      const { error } = await supabase.from('past_client_property').upsert(row, { onConflict: 'contact_id' })
      if (error) throw error
    }
  }
  const { error } = await supabase.from('enrichment_review').update({ decision, decided_at: at }).eq('id', review.id)
  if (error) throw error
}

// Coverage: share of the past-client list with property data, and share
// touched in the last 90 and 180 days.
export async function loadCoverage(now = new Date()) {
  if (isDemoMode) return null
  const ago = (d) => new Date(now.getTime() - d * 86_400_000).toISOString()
  const base = () =>
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay').eq('raw->>source', 'Past Client')
  const [total, withProp, t90, t180, reviews] = await Promise.all([
    base(),
    supabase.from('past_client_property').select('contact_id', { count: 'exact', head: true }).not('address', 'is', null),
    base().gte('last_activity_at', ago(90)),
    base().gte('last_activity_at', ago(180)),
    supabase.from('enrichment_review').select('id', { count: 'exact', head: true }).eq('decision', 'pending'),
  ])
  for (const r of [total, withProp, t90, t180, reviews]) if (r.error) throw r.error
  return { total: total.count || 0, withProperty: withProp.count || 0, touched90: t90.count || 0, touched180: t180.count || 0, pendingReview: reviews.count || 0 }
}
