// Arive Pipeline Report CSV → loans rows (docs/superpowers/specs/
// 2026-10-30-arive-loans-import-design.md). Pure: no Supabase here.

export const REQUIRED_HEADERS = ['ARIVE Loan Id', 'Stage Name', 'Total Loan Amount', 'Primary Loan Officer Name', 'Primary Borrower']

// Display order for the Pipeline Status panel.
export const STAGE_GROUPS = [
  { key: 'prospect', label: 'Prospect', stages: ['App Intake', 'Qualification', 'Pre-Approved'] },
  { key: 'processing', label: 'Processing', stages: ['Loan Setup', 'Disclosed', 'Submitted to UW', 'Approved w/ Conditions', 'Re-Submittal'] },
  { key: 'closing', label: 'Closing', stages: ['Clear To Close', 'Docs Out', 'Docs Signed'] },
  { key: 'funded', label: 'Funded', stages: ['Loan Funded', 'Broker Check Received', 'Loan Finalized'] },
  { key: 'adverse', label: 'Adverse', stages: ['Adverse'] },
]

export const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const GROUP_OF = new Map(STAGE_GROUPS.flatMap((g) => g.stages.map((s) => [norm(s), g.key])))

export function stageGroup(stage) {
  return GROUP_OF.get(norm(stage)) ?? 'other'
}

const text = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}
const num = (v) => {
  const s = String(v ?? '').replace(/[$,%\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const phone10 = (v) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

export function parseUsDate(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[3]), Number(m[1]), Number(m[2])]
  const dt = new Date(0)
  dt.setUTCFullYear(y, mo - 1, d)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const PLACEHOLDER_LOCALS = new Set(['aaa', '123', '456', 'lead', 'test'])
const PLACEHOLDER_DOMAINS = new Set(['noone.com', '123.com'])
const PLACEHOLDER_NAMES = new Set(['test', 'tbd', 'client', 'dscr'])
const PLACEHOLDER_PHRASES = ['cost sheet', 'renovation loan']

// Scenario / test files: quotes and what-ifs Arive keeps as loans.
export function isScenarioRow({ first, last, name, email, phone }) {
  const [local, domain] = norm(email).split('@')
  if (email && (PLACEHOLDER_LOCALS.has(local) || PLACEHOLDER_DOMAINS.has(domain))) return true
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length >= 10 && /^(\d)\1{9}$/.test(d.slice(-10))) return true
  if (PLACEHOLDER_NAMES.has(norm(first)) || PLACEHOLDER_NAMES.has(norm(last))) return true
  const full = norm(name)
  return PLACEHOLDER_PHRASES.some((p) => full.includes(p))
}

export function rowToLoan(row, { loName }) {
  const get = (h) => row[h]
  const first = text(get('Primary Borrower First Name'))
  const last = text(get('Primary Borrower Last Name'))
  const name = text(get('Primary Borrower')) ?? ([first, last].filter(Boolean).join(' ') || null)
  const email = text(get('Primary Borrower Email'))
  const phone = phone10(get('Primary Borrower Cell Phone'))
  const officer = text(get('Primary Loan Officer Name'))
  const stage = text(get('Stage Name'))
  const term = num(get('Loan Term'))
  return {
    arive_loan_id: text(get('ARIVE Loan Id')),
    loan_officer: officer,
    role: norm(officer) === norm(loName) ? 'primary' : 'assisted',
    borrower_name: name,
    borrower_first: first,
    borrower_last: last,
    borrower_email: email,
    borrower_phone: phone,
    co_borrower_name: text(get('Co-Borrower')),
    co_borrower_email: text(get('Co-Borrower Email')),
    amount: num(get('Total Loan Amount')),
    purpose: text(get('Loan Purpose')),
    stage,
    stage_group: stageGroup(stage),
    property_address: text(get('Subject Property')),
    property_state: text(get('Subject State')),
    lender: text(get('Lender')),
    title_company: text(get('Title Company')),
    closed_on: parseUsDate(get('Docs Signed / Loan Closed')),
    funded_on: parseUsDate(get('Loan Funded')),
    firm_closing_on: parseUsDate(get('Firm Closing Date')),
    application_on: parseUsDate(get('Application Date')),
    rate: num(get('Note Rate')),
    loan_type: text(get('Loan Type')),
    term_months: term == null ? null : Math.round(term),
    buyer_agent_name: text(get('Buyer Agent')),
    buyer_agent_company: text(get('Buyer Agent Company Name')),
    buyer_agent_email: text(get('Buyer Agent Email')),
    buyer_agent_phone: phone10(get('Buyer Agent Phone')),
    seller_agent_name: text(get('Seller Agent')),
    seller_agent_company: text(get('Seller Agent Company Name')),
    seller_agent_email: text(get('Seller Agent Email')),
    seller_agent_phone: phone10(get('Seller Agent Phone')),
    scenario_auto: isScenarioRow({ first, last, name, email, phone: get('Primary Borrower Cell Phone') }),
    raw: row,
  }
}

// Bayway contacts: [{ id, name, email, phone }]. Email, then last-10 phone,
// then an exact full name held by exactly one contact.
export function matchContact(loan, contacts) {
  if (loan.scenario_auto) return null
  const email = norm(loan.borrower_email)
  if (email) {
    const hit = contacts.find((c) => norm(c.email) === email)
    if (hit) return hit.id
  }
  if (loan.borrower_phone) {
    const hit = contacts.find((c) => phone10(c.phone) === loan.borrower_phone)
    if (hit) return hit.id
  }
  const name = norm(loan.borrower_name)
  if (name) {
    const hits = contacts.filter((c) => norm(c.name) === name)
    if (hits.length === 1) return hits[0].id
  }
  return null
}

// Columns the import owns; a difference in any of them makes a row "updated".
export const IMPORT_FIELDS = [
  'loan_officer', 'role', 'borrower_name', 'borrower_first', 'borrower_last', 'borrower_email', 'borrower_phone',
  'co_borrower_name', 'co_borrower_email', 'contact_id', 'amount', 'purpose', 'stage', 'stage_group',
  'property_address', 'property_state', 'lender', 'title_company', 'closed_on', 'funded_on', 'firm_closing_on',
  'application_on', 'rate', 'loan_type', 'term_months', 'buyer_agent_name', 'buyer_agent_company',
  'buyer_agent_email', 'buyer_agent_phone', 'seller_agent_name', 'seller_agent_company', 'seller_agent_email',
  'seller_agent_phone', 'scenario_auto',
]

// Blank = null / undefined / ''. Numbers and booleans compare by value
// (PostgREST may hand numerics back as strings); everything else as text.
const same = (a, b) => {
  const blank = (v) => v == null || v === ''
  if (blank(a) || blank(b)) return blank(a) && blank(b)
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  return String(a) === String(b)
}

// existing: loans already stored ({ arive_loan_id, ...IMPORT_FIELDS }).
// Returns { error } or { loans, counts, unknownStages, missingIds }.
export function buildPreview({ header, rows, existing, contacts, loName }) {
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !header.includes(h))
  if (missingHeaders.length) return { error: `This file is missing: ${missingHeaders.join(', ')}. Export the saved Arive report again.` }
  const byId = new Map(existing.map((l) => [String(l.arive_loan_id), l]))
  const loans = []
  const counts = { total: 0, new: 0, updated: 0, unchanged: 0, skipped: 0, scenario: 0, unmatched: 0, missing: 0 }
  const unknown = new Set()
  const seen = new Set()
  for (const row of rows) {
    const loan = rowToLoan(row, { loName })
    if (!loan.arive_loan_id || seen.has(loan.arive_loan_id)) { counts.skipped++; continue }
    seen.add(loan.arive_loan_id)
    const prev = byId.get(loan.arive_loan_id)
    // A manual scenario toggle on the stored row beats detection (as isScenario does).
    const scen = prev?.scenario_override ?? loan.scenario_auto
    loan.contact_id = scen ? null : matchContact({ ...loan, scenario_auto: false }, contacts)
    loans.push(loan)
    if (loan.stage_group === 'other') unknown.add(loan.stage ?? '(blank)')
    if (scen) counts.scenario++
    else if (!loan.contact_id) counts.unmatched++
    if (!prev) counts.new++
    else if (IMPORT_FIELDS.every((f) => same(loan[f], prev[f]))) counts.unchanged++
    else counts.updated++
  }
  counts.total = loans.length
  const missingIds = existing.map((l) => String(l.arive_loan_id)).filter((id) => !seen.has(id))
  counts.missing = missingIds.length
  return { loans, counts, unknownStages: [...unknown], missingIds }
}
