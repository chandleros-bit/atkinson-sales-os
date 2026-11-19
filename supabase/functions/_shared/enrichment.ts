// Database Opportunity Agent: enrichment import (spec "Data enrichment
// pipeline", steps 3 and 4). Pure helpers: CSV parsing, mapping a returned
// match-file row to property facts, and merging into what is already stored.
//
// Accepts the past_client_match_file.csv layout, filled in by the title rep or
// by the county match: fub_id, the "(return)" columns, and the optional
// hcad_account, market_value, homestead, confidence and match_note columns.

export type Source = 'arive' | 'title_rep' | 'hcad' | 'fbcad' | 'mcad' | 'paid' | 'manual'
export type Confidence = 'high' | 'medium' | 'low'

export type Property = {
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  recording_date: string | null
  sale_price: number | null
  orig_loan_amount: number | null
  lender: string | null
  market_value: number | null
  market_value_year: number | null
  homestead: boolean | null
  kept_prior_home: boolean
  owner_names: string | null
}

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (!head) return []
  const keys = head.map((h) => h.trim())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const get = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) {
    const v = r[n] ?? r[`${n} (return)`]
    if (v != null && v !== '') return v
  }
  return ''
}
const money = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ''))
  return v && Number.isFinite(n) && n > 0 ? Math.round(n) : null
}
function isoDate(v: string): string | null {
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

// "123 Main St, Katy, TX 77494" -> parts. Falls back to the whole string.
export function splitAddress(v: string) {
  const m = v.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})/i)
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] }
  return { address: v.trim() || null, city: null, state: null, zip: null }
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean)

// Title rep rows carry no confidence column: high when the recorded owner
// names include the client's first and last name, medium when only the last
// name, low otherwise.
export function inferConfidence(r: Record<string, string>): Confidence {
  const owners = norm(get(r, 'owner_names_as_recorded', 'owner_names'))
  const first = norm(r.first_name || '')[0]
  const last = norm(r.last_name || '').at(-1)
  if (!last || !owners.includes(last)) return 'low'
  return first && owners.includes(first) ? 'high' : 'medium'
}

export type Mapped = {
  fubId: string
  confidence: Confidence
  property: Property | null
  note: string
}

export function mapRow(r: Record<string, string>, opts: { marketValueYear?: number } = {}): Mapped | null {
  const fubId = (r.fub_id || '').trim()
  if (!fubId) return null
  const addr = get(r, 'property_address')
  const note = r.match_note || ''
  if (!addr) return { fubId, confidence: 'low', property: null, note }
  const conf = (['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : inferConfidence(r)) as Confidence
  const parts = splitAddress(addr)
  const hs = (r.homestead || '').toUpperCase()
  const mv = money(r.market_value || '')
  return {
    fubId,
    confidence: conf,
    note,
    property: {
      ...parts,
      county: get(r, 'county') || null,
      recording_date: isoDate(get(r, 'recording_date')),
      sale_price: money(get(r, 'sale_price')),
      orig_loan_amount: money(get(r, 'original_loan_amount', 'orig_loan_amount')),
      lender: get(r, 'lender') || null,
      market_value: mv,
      market_value_year: mv != null ? opts.marketValueYear ?? null : null,
      homestead: hs === 'Y' ? true : hs === 'N' ? false : null,
      kept_prior_home: /KEPT_PRIOR_HOME/.test(note),
      owner_names: get(r, 'owner_names_as_recorded', 'owner_names') || null,
    },
  }
}

// Merge an accepted match into the stored row. A row Chandler typed by hand
// (is_manual) is never overwritten. A blank incoming value never erases a
// stored one, so the county match and the title rep file can fill each other
// in. A different property address replaces the row (the newer match wins).
export function mergeProperty(
  existing: (Partial<Property> & { is_manual?: boolean; source?: string | null }) | null,
  incoming: Property,
  source: Source,
  confidence: Confidence,
): Record<string, unknown> | null {
  if (existing?.is_manual) return null
  const { owner_names: _drop, ...facts } = incoming
  const sameProperty =
    !existing?.address || !incoming.address ||
    norm(existing.address).join(' ') === norm(incoming.address).join(' ')
  const base = sameProperty && existing ? { ...existing } : {}
  const merged: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(facts)) {
    if (v !== null && v !== '' && !(k === 'kept_prior_home' && v === false)) merged[k] = v
    else if (!(k in merged)) merged[k] = v
  }
  merged.source = sameProperty && existing?.source && existing.source !== source ? existing.source : source
  merged.confidence = confidence
  merged.is_manual = false
  merged.no_property_found = false
  delete merged.updated_at
  return merged
}
