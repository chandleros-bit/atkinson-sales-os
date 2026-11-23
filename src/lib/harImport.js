// HAR import and partner scoring (Bayway Bot Engine doc, Sales OS weeks 3-4).
// One CSV template, filled from HAR.com agent profiles by hand or by the Scout
// bot. Each agent gets a 1 to 10 score on the doc's five factors:
//   closings in the last 12 months, average price in the loan range,
//   buyer-side share, area overlap with Katy / Cypress / West Houston,
//   and signs of an existing preferred lender.
// Rows match existing partners by HAR link, email, phone or name, and update
// only the HAR fields and score; new agents come in as Prospects. Pure, except
// saveHarImport.
import { supabase } from './supabase'

export const TEMPLATE_COLUMNS = ['Name', 'Brokerage', 'Email', 'Phone', 'HAR URL', 'Closings 12mo', 'Volume 12mo', 'Avg Price', 'Buyer Side %', 'Areas', 'Preferred Lender']

export function templateCsv() {
  return `${TEMPLATE_COLUMNS.join(',')}\nJane Example,Example Realty,jane@example.com,713-555-0100,https://www.har.com/janeexample,14,5200000,371000,70,"Katy, Cypress",\n`
}

// Header aliases, lowercased with spaces and symbols removed.
const ALIASES = {
  name: ['name', 'agentname', 'agent', 'fullname'],
  brokerage: ['brokerage', 'office', 'company', 'broker', 'officename'],
  email: ['email', 'emailaddress'],
  phone: ['phone', 'cell', 'mobile', 'phonenumber'],
  har_url: ['harurl', 'har', 'harlink', 'profile', 'profileurl', 'url', 'link'],
  closings_12mo: ['closings12mo', 'closings', 'sales12mo', 'transactions12mo', 'transactions', 'units', 'deals'],
  volume_12mo: ['volume12mo', 'volume', 'salesvolume', 'totalvolume'],
  avg_price: ['avgprice', 'averageprice', 'avgsaleprice', 'averagesaleprice'],
  buyer_side_pct: ['buyerside', 'buyersidepct', 'buyersidepercent', 'buyerpct', 'buyersideshare'],
  areas: ['areas', 'area', 'markets', 'cities', 'serviceareas'],
  preferred_lender: ['preferredlender', 'lender', 'partnerlender'],
}
const key = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function mapHeader(header) {
  const out = {}
  for (const h of header || []) {
    const k = key(h)
    for (const [field, names] of Object.entries(ALIASES)) if (!out[field] && names.includes(k)) out[field] = h
  }
  return out
}

const num = (v) => {
  const s = String(v ?? '').replace(/[$,%\s]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const text = (v) => (String(v ?? '').trim() || null)

export function rowToAgent(row, map) {
  const get = (f) => (map[f] ? row[map[f]] : '')
  let buyer = num(get('buyer_side_pct'))
  if (buyer != null && buyer > 0 && buyer <= 1) buyer = buyer * 100 // 0.7 means 70%
  const closings = num(get('closings_12mo'))
  const volume = num(get('volume_12mo'))
  let avg = num(get('avg_price'))
  if (avg == null && closings && volume) avg = Math.round(volume / closings)
  return {
    name: text(get('name')),
    brokerage: text(get('brokerage')),
    email: text(get('email'))?.toLowerCase() || null,
    phone: text(get('phone')),
    har_url: text(get('har_url')),
    closings_12mo: closings == null ? null : Math.round(closings),
    volume_12mo: volume,
    avg_price: avg,
    buyer_side_pct: buyer,
    areas: text(get('areas')),
    preferred_lender: text(get('preferred_lender')),
  }
}

// ---- Scoring -----------------------------------------------------------------

export const LOAN_RANGE = { low: 250_000, high: 750_000 }
const CORE_AREAS = ['katy', 'cypress', 'west houston', 'energy corridor', 'fulshear', 'memorial']
const NEAR_AREAS = ['houston', 'spring', 'tomball', 'sugar land', 'richmond', 'hockley', 'brookshire', 'waller', 'jersey village', 'bellaire', 'missouri city']
export const WEIGHTS = { closings: 0.3, price: 0.2, buyer: 0.2, area: 0.2, lender: 0.1 }
const clamp = (n) => Math.max(1, Math.min(10, n))

// Each part 1 to 10; unknown data scores a neutral 5 so a blank column
// neither sinks nor lifts an agent.
export function scoreParts(a) {
  const closings = a.closings_12mo == null ? 5 : clamp(1 + a.closings_12mo / 3) // 27+ closings = 10
  let price = 5
  if (a.avg_price != null) {
    const p = a.avg_price
    if (p >= LOAN_RANGE.low && p <= LOAN_RANGE.high) price = 10
    else if (p < LOAN_RANGE.low) price = clamp(10 * (p / LOAN_RANGE.low) ** 2)
    else price = clamp(10 * (LOAN_RANGE.high / p) ** 2)
  }
  const buyer = a.buyer_side_pct == null ? 5 : clamp(a.buyer_side_pct / 10)
  let area = 5
  if (a.areas) {
    const s = a.areas.toLowerCase()
    area = CORE_AREAS.some((x) => s.includes(x)) ? 10 : NEAR_AREAS.some((x) => s.includes(x)) ? 6 : 2
  }
  const lender = a.preferred_lender ? 3 : 10
  const round = (n) => Math.round(n * 10) / 10
  return { closings: round(closings), price: round(price), buyer: round(buyer), area: round(area), lender }
}

export function scoreAgent(a) {
  const parts = scoreParts(a)
  const total = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + parts[k] * w, 0)
  return { score: Math.round(total * 10) / 10, parts }
}

// Dream 20 and bench of 80 from scores: rank 1-20 dream, 21-100 bench.
export function tierFor(rank) {
  if (rank == null) return null
  if (rank <= 20) return 'Dream 20'
  if (rank <= 100) return 'Bench'
  return null
}

// ---- Preview ---------------------------------------------------------------------

const phone10 = (p) => {
  const d = String(p || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}
const lower = (s) => String(s || '').trim().toLowerCase()

export function findPartner(agent, partners) {
  return (
    (agent.har_url && partners.find((p) => p.har_url && lower(p.har_url) === lower(agent.har_url))) ||
    (agent.email && partners.find((p) => p.email && lower(p.email) === agent.email)) ||
    (phone10(agent.phone) && partners.find((p) => phone10(p.phone) === phone10(agent.phone))) ||
    partners.find((p) => lower(p.name) === lower(agent.name)) ||
    null
  )
}

// -> { error } | { inserts, updates, skipped, counts }
export function buildHarPreview({ header, rows, partners }, now = new Date()) {
  const map = mapHeader(header)
  if (!map.name) return { error: `No Name column. Use the template: ${TEMPLATE_COLUMNS.join(', ')}` }
  const inserts = []
  const updates = []
  let skipped = 0
  const seen = new Set()
  for (const row of rows || []) {
    const a = rowToAgent(row, map)
    if (!a.name) { skipped++; continue }
    const dedupe = a.har_url ? lower(a.har_url) : a.email || lower(a.name)
    if (seen.has(dedupe)) { skipped++; continue }
    seen.add(dedupe)
    const { score, parts } = scoreAgent(a)
    const har = {
      har_url: a.har_url, closings_12mo: a.closings_12mo, volume_12mo: a.volume_12mo, avg_price: a.avg_price,
      buyer_side_pct: a.buyer_side_pct, areas: a.areas, preferred_lender: a.preferred_lender,
      score, score_parts: parts, har_updated_at: now.toISOString(), updated_at: now.toISOString(),
    }
    const match = findPartner(a, partners || [])
    if (match) {
      // Fill contact details only where the profile has none.
      updates.push({ id: match.id, name: match.name, patch: { ...har, brokerage: match.brokerage || a.brokerage, email: match.email || a.email, phone: match.phone || a.phone } })
    } else {
      inserts.push({ name: a.name, brokerage: a.brokerage, email: a.email, phone: a.phone, source: 'har', partner_type: 'realtor', ...har })
    }
  }
  return { inserts, updates, skipped, counts: { new: inserts.length, updated: updates.length, skipped, total: inserts.length + updates.length } }
}

export async function saveHarImport(preview) {
  for (let i = 0; i < preview.inserts.length; i += 200) {
    const { error } = await supabase.from('partner_profiles').insert(preview.inserts.slice(i, i + 200))
    if (error) return { error }
  }
  for (const u of preview.updates) {
    const { error } = await supabase.from('partner_profiles').update(u.patch).eq('id', u.id)
    if (error) return { error }
  }
  return { error: null }
}
