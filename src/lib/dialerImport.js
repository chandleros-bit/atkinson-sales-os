// Power Dialer CSV import (spec 2026-11-20, "Upload and map"). Pure: header
// auto-mapping, phone normalization, name splitting and the upload checks.
// Parsing is lib/csv.js; saving is lib/dialerData.js.

// The fields a column can map to, in the order the mapping screen shows them.
export const FIELDS = [
  { key: 'phone', label: 'Phone', required: true },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'full_name', label: 'Full name (split into first and last)' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Zip' },
]

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Per field: exact normalized names first, then a looser pattern. Fields are
// matched in this order and each header is used once, so the specific ones
// (email before address, company before the person's name) claim theirs first.
const RULES = [
  ['email', ['email', 'emailaddress'], /e?mail/],
  ['phone', ['phone', 'mobile', 'cell', 'cellphone', 'mobilephone', 'phonenumber', 'telephone', 'tel', 'primaryphone', 'wireless'],
    /phone|mobile|cell|wireless/],
  ['first_name', ['first', 'firstname', 'fname', 'givenname'], /first/],
  ['last_name', ['last', 'lastname', 'lname', 'surname'], /last|surname/],
  ['company', ['company', 'companyname', 'business', 'businessname', 'dba', 'organization', 'accountname'],
    /company|business|dba|organi[sz]ation/],
  ['zip', ['zip', 'zipcode', 'postalcode', 'postcode'], /zip|postal|postcode/],
  ['city', ['city', 'town'], /city/],
  ['state', ['state', 'st', 'province', 'stateprovince'], /state(?!ment)/],
  ['address', ['address', 'street', 'address1', 'streetaddress'], /address|street/],
  ['full_name', ['name', 'fullname', 'ownername', 'contactname', 'contact', 'owner', 'primaryname'],
    /name/],
]
// A column named for the business or a file is never the person.
const NOT_PERSON = /business|company|file|list|street|first|last/

export function autoMap(header) {
  const used = new Set()
  const out = Object.fromEntries(FIELDS.map((f) => [f.key, '']))
  for (const [key, exact, loose] of RULES) {
    const free = header.filter((h) => !used.has(h))
    let hit = free.find((h) => exact.includes(norm(h)))
    if (!hit) hit = free.find((h) => loose.test(norm(h)) && (key !== 'full_name' || !NOT_PERSON.test(norm(h))))
    if (hit) {
      out[key] = hit
      used.add(hit)
    }
  }
  return out
}

export const mappingError = (mapping) => (mapping?.phone ? null : 'Pick the column that holds the phone number.')

export const listNameFrom = (filename) => String(filename || '').replace(/\.[^.]+$/, '').trim()

// E.164 or null. US default: 10 digits (or 11 with a leading 1) that pass the
// NANP rules (area code and exchange start 2-9). A number written with + and
// another country code is kept as is.
export function normalizePhone(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return null
  // Excel turns long numbers into 8.325551234E+09.
  if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0)
  s = s.split(/\s*(?:ext\.?|extension|x|#)\s*\d*$/i)[0]
  if (/[a-wyz]/i.test(s)) return null
  const plus = s.startsWith('+')
  let digits = s.replace(/\D/g, '')
  if (plus && !digits.startsWith('1')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10 || !/^[2-9]\d{2}[2-9]/.test(digits)) return null
  return `+1${digits}`
}

// "Jane Smith" -> Jane / Smith; "Smith, Jane" -> Jane / Smith.
export function splitName(full) {
  const s = String(full ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return { first: '', last: '' }
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((p) => p.trim())
    return { first: first || '', last: last || '' }
  }
  const parts = s.split(' ')
  if (parts.length === 1) return { first: s, last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

const clean = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

// Rows -> leads ready to save, plus the upload summary. dnc: Set of E.164
// numbers. A repeat of a number already in the file is left out (the first
// row wins); every other row is saved, with a status the queue respects.
// crm: { [e164]: match } from the CRM check. A number already in the CRM is
// saved as crm_duplicate (never dialed) unless includeCrm is on; its match is
// kept on the lead either way.
export function buildLeads({ header, rows, mapping, dnc, crm = {}, includeCrm = false }) {
  const mapped = new Set(Object.values(mapping).filter(Boolean))
  const get = (row, key) => (mapping[key] ? clean(row[mapping[key]]) : null)
  const seen = new Set()
  const leads = []
  const summary = { total: rows.length, ready: 0, dnc: 0, badPhone: 0, inFileDupes: 0, crm: 0 }

  for (const row of rows) {
    const phoneRaw = get(row, 'phone')
    const e164 = normalizePhone(phoneRaw)
    if (e164 && seen.has(e164)) {
      summary.inFileDupes++
      continue
    }
    if (e164) seen.add(e164)

    let first = get(row, 'first_name')
    let last = get(row, 'last_name')
    const full = get(row, 'full_name')
    if (full && !first && !last) {
      const n = splitName(full)
      first = clean(n.first)
      last = clean(n.last)
    }
    const extra = {}
    for (const h of header) {
      if (!mapped.has(h) && clean(row[h]) != null) extra[h] = clean(row[h])
    }

    let status = 'queued'
    const match = e164 ? crm[e164] || null : null
    if (!e164) { status = 'invalid_phone'; summary.badPhone++ }
    else if (dnc.has(e164)) { status = 'dnc'; summary.dnc++ }
    else {
      if (match) summary.crm++
      if (match && !includeCrm) status = 'crm_duplicate'
      else summary.ready++
    }

    leads.push({
      first_name: first,
      last_name: last,
      company: get(row, 'company'),
      phone_raw: phoneRaw,
      phone_e164: e164,
      email: get(row, 'email'),
      address: get(row, 'address'),
      city: get(row, 'city'),
      state: get(row, 'state'),
      zip: get(row, 'zip'),
      extra,
      status,
      crm_match: match,
      position: leads.length + 1,
    })
  }
  return { leads, summary }
}
