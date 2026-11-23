// Class tracker and partner funnel (Bayway Bot Engine doc, Sales OS weeks 5-6).
// Each class has a date, topic, host brokerage and a roster of partners with a
// status: invited, registered, attended or no-show. Inviting and attending move
// a partner's stage forward (never back). Owner-only (RLS).
import { supabase, isDemoMode } from './supabase'
import { PARTNER_STAGES } from './partners'

export const ROSTER_STATUSES = [
  { key: 'invited', label: 'Invited' },
  { key: 'registered', label: 'Registered' },
  { key: 'attended', label: 'Attended' },
  { key: 'no_show', label: 'No-show' },
]
const ORDER = Object.fromEntries(PARTNER_STAGES.map((s, i) => [s.key, i]))
const STAGE_FOR = { invited: 'invited', registered: 'invited', attended: 'attended_class' }

// The stage a roster status moves a partner to, or null to leave it alone.
export function advanceStage(current, status) {
  const target = STAGE_FOR[status]
  if (!target) return null
  return (ORDER[current] ?? 0) < ORDER[target] ? target : null
}

// Funnel counts with each step as a share of the one before.
export function funnelSteps(f) {
  const steps = [
    { key: 'invited', label: 'Invited', n: Number(f?.invited || 0) },
    { key: 'registered', label: 'Registered', n: Number(f?.registered || 0) },
    { key: 'attended', label: 'Attended a class', n: Number(f?.attended || 0) },
    { key: 'one_to_ones', label: 'One-to-ones', n: Number(f?.one_to_ones || 0) },
    { key: 'referrals', label: 'Referrals', n: Number(f?.referrals || 0) },
  ]
  return steps.map((s, i) => {
    const prev = i ? steps[i - 1].n : null
    return { ...s, pct: i && prev ? Math.round((s.n / prev) * 100) : null }
  })
}

export function rosterCounts(rows) {
  const out = { invited: 0, registered: 0, attended: 0, no_show: 0 }
  for (const r of rows || []) if (r.status in out) out[r.status] += 1
  return out
}

export async function loadClasses() {
  if (isDemoMode) return []
  const { data, error } = await supabase.from('partner_classes').select('*, class_attendance(status)').order('class_date', { ascending: false }).limit(100)
  if (error) throw error
  return (data || []).map((c) => ({ ...c, counts: rosterCounts(c.class_attendance) }))
}

export function newClassRow({ class_date, topic, host_brokerage, location }) {
  if (!class_date) throw new Error('Pick a date')
  if (!String(topic || '').trim()) throw new Error('Topic is required')
  const clean = (v) => String(v || '').trim() || null
  return { class_date, topic: topic.trim(), host_brokerage: clean(host_brokerage), location: clean(location) }
}

export async function addClass(fields) {
  const { error } = await supabase.from('partner_classes').insert(newClassRow(fields))
  if (error) throw error
}

export async function loadRoster(classId) {
  const { data, error } = await supabase
    .from('class_attendance')
    .select('class_id, partner_id, status, partner:partner_profiles(name, brokerage, partner_stage)')
    .eq('class_id', classId)
    .limit(500)
  if (error) throw error
  return (data || []).sort((a, b) => String(a.partner?.name).localeCompare(String(b.partner?.name)))
}

// Upsert a roster row and move the partner's stage forward when it fits.
export async function setRoster(classId, partner, status) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('class_attendance').upsert({ class_id: classId, partner_id: partner.id, status, updated_at: now }, { onConflict: 'class_id,partner_id' })
  if (error) throw error
  const next = advanceStage(partner.partner_stage, status)
  if (next) {
    const { error: e2 } = await supabase.from('partner_profiles').update({ partner_stage: next, stage_since: now, updated_at: now }).eq('id', partner.id)
    if (e2) throw e2
  }
  return next
}

export async function removeFromRoster(classId, partnerId) {
  const { error } = await supabase.from('class_attendance').delete().eq('class_id', classId).eq('partner_id', partnerId)
  if (error) throw error
}

export async function loadFunnel(from, to) {
  if (isDemoMode) return null
  const { data, error } = await supabase.rpc('partner_funnel', { p_from: from, p_to: to })
  if (error) throw error
  return (data || [])[0] || null
}
