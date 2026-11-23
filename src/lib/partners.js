// Partners tab (Bayway Bot Engine doc, Sales OS week 1): realtors at the FUB
// Realtors stage plus agents from Arive loans, each with a partner stage, a
// type and a last touch. Owner-only (RLS on partner_profiles).
import { supabase, isDemoMode } from './supabase'
import { centralToday } from './opportunities'

export const PARTNER_STAGES = [
  { key: 'prospect', label: 'Prospect' },
  { key: 'dream_20', label: 'Dream 20' },
  { key: 'invited', label: 'Invited' },
  { key: 'attended_class', label: 'Attended class' },
  { key: 'one_to_one', label: 'One-to-one' },
  { key: 'referring', label: 'Referring' },
  { key: 'top_partner', label: 'Top Partner' },
]
export const STAGE_LABEL = Object.fromEntries(PARTNER_STAGES.map((s) => [s.key, s.label]))

export const PARTNER_TYPES = [
  { key: 'realtor', label: 'Realtor' },
  { key: 'investor_agent', label: 'Investor agent' },
  { key: 'property_manager', label: 'Property manager' },
]
export const TYPE_LABEL = Object.fromEntries(PARTNER_TYPES.map((t) => [t.key, t.label]))

export const SOURCE_LABEL = { fub: 'FUB', arive: 'Arive loan', manual: 'Added here' }

// Gone quiet: no touch in this many days.
export const QUIET_DAYS = 30

const DAY = 86_400_000

// Whole days since a timestamp (null when never touched).
export function daysSince(ts, now = new Date()) {
  if (!ts) return null
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY))
}

export function lastTouchText(ts, now = new Date()) {
  const d = daysSince(ts, now)
  if (d == null) return 'Never'
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

// due: next touch date is today or earlier. quiet: no touch in QUIET_DAYS.
export function touchStatus(p, now = new Date()) {
  const today = centralToday(now)
  if (p.next_touch_due && p.next_touch_due <= today) return 'due'
  const d = daysSince(p.last_touch_at, now)
  if (d == null || d >= QUIET_DAYS) return 'quiet'
  return 'ok'
}

export function stageCounts(rows) {
  const out = Object.fromEntries(PARTNER_STAGES.map((s) => [s.key, 0]))
  for (const r of rows || []) if (r.partner_stage in out) out[r.partner_stage] += 1
  return out
}

const norm = (s) => String(s || '').toLowerCase()

// filter: { stage: 'all' | key, type: 'all' | key, q, due: bool }
export function filterPartners(rows, { stage = 'all', type = 'all', q = '', due = false } = {}, now = new Date()) {
  const needle = norm(q).trim()
  return (rows || []).filter((r) => {
    if (stage !== 'all' && r.partner_stage !== stage) return false
    if (type !== 'all' && r.partner_type !== type) return false
    if (due && touchStatus(r, now) === 'ok') return false
    if (needle && !`${norm(r.name)} ${norm(r.brokerage)} ${norm(r.email)}`.includes(needle)) return false
    return true
  })
}

// Furthest stage first, then the most overdue touch.
const STAGE_RANK = Object.fromEntries(PARTNER_STAGES.map((s, i) => [s.key, i]))
export function sortPartners(rows) {
  return [...(rows || [])].sort((a, b) => {
    const s = (STAGE_RANK[b.partner_stage] ?? 0) - (STAGE_RANK[a.partner_stage] ?? 0)
    if (s) return s
    const ta = a.last_touch_at ? new Date(a.last_touch_at).getTime() : 0
    const tb = b.last_touch_at ? new Date(b.last_touch_at).getTime() : 0
    if (ta !== tb) return ta - tb
    return String(a.name).localeCompare(String(b.name))
  })
}

// Adds new Realtors-stage contacts and loan agents; returns how many.
export async function syncPartners() {
  if (isDemoMode) return 0
  const { data, error } = await supabase.rpc('sync_partner_profiles')
  if (error) throw error
  return data || 0
}

export async function loadPartners() {
  if (isDemoMode) return []
  const { data, error } = await supabase.from('v_partners').select('*').order('name').limit(2000)
  if (error) throw error
  return data || []
}

const EDITABLE = new Set(['partner_stage', 'partner_type', 'next_touch_due', 'brokerage', 'notes'])

// One field on one profile. A stage change restarts stage_since.
export function buildPatch(field, value, now = new Date()) {
  if (!EDITABLE.has(field)) throw new Error(`Can't edit ${field}`)
  const patch = { [field]: value === '' ? null : value, updated_at: now.toISOString() }
  if (field === 'partner_stage') {
    if (!STAGE_LABEL[value]) throw new Error(`Unknown stage: ${value}`)
    patch.stage_since = now.toISOString()
  }
  if (field === 'partner_type' && !TYPE_LABEL[value]) throw new Error(`Unknown type: ${value}`)
  return patch
}

export async function updatePartner(id, field, value) {
  const patch = buildPatch(field, value)
  const { error } = await supabase.from('partner_profiles').update(patch).eq('id', id)
  if (error) throw error
  return patch
}

export function newPartnerRow({ name, brokerage, email, phone, partner_type = 'realtor' }) {
  const n = String(name || '').trim()
  if (!n) throw new Error('Name is required')
  const clean = (v) => (String(v || '').trim() || null)
  return { name: n, brokerage: clean(brokerage), email: clean(email), phone: clean(phone), partner_type, source: 'manual' }
}

export async function addPartner(fields) {
  const row = newPartnerRow(fields)
  const { error } = await supabase.from('partner_profiles').insert(row)
  if (error) throw error
}

// Rank among scored partners, best first: id -> 1..n (HAR import scores).
export function scoreRanks(rows) {
  const scored = (rows || []).filter((r) => r.score != null).sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
  return new Map(scored.map((r, i) => [r.id, i + 1]))
}

// Highest score first; unscored last, then by name.
export function sortByScore(rows) {
  return [...(rows || [])].sort((a, b) => {
    if (a.score == null && b.score == null) return String(a.name).localeCompare(String(b.name))
    if (a.score == null) return 1
    if (b.score == null) return -1
    return b.score - a.score || String(a.name).localeCompare(String(b.name))
  })
}
