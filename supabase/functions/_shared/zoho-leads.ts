// Pure helpers for promoting an MPG prospect to a Zoho Lead (crm-action
// promote_prospect; spec 2026-11-05, Promotion to Zoho). No fetch.
// COQL escapes a single quote by doubling it; `\'` is a syntax error (checked
// live 2026-11-06). Company '=' is case-insensitive in Zoho.

export const INITIAL_LEAD = 'initial lead' // lower-cased Lead_Status the OS hides (0044)
const FIELDS = 'id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status'
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '')

export const coqlString = (s) => `'${String(s).replace(/'/g, "''")}'`

const tenDigits = (raw) => {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}
const norm = (s) => trimmed(String(s ?? '')).replace(/\s+/g, ' ').toLowerCase()

// COQL for leads that might be this business: same phone tail or same company.
export function findLeadsQuery({ phoneKey, company }) {
  const parts = []
  if (phoneKey) {
    const tail = coqlString(`%${phoneKey.slice(-4)}`)
    parts.push(`(Phone like ${tail} or Mobile like ${tail})`)
  }
  if (trimmed(company)) parts.push(`Company = ${coqlString(trimmed(company))}`)
  if (!parts.length) return null
  return `select ${FIELDS} from Leads where (${parts.join(' or ')}) limit 50`
}

// The real matches among the COQL rows: the full 10-digit phone, or the
// company ignoring case and spacing. -> picker-ready candidates.
export function matchLeads(records, { phoneKey, company }) {
  const want = norm(company)
  return (records || [])
    .filter((r) => (phoneKey && (tenDigits(r.Phone) === phoneKey || tenDigits(r.Mobile) === phoneKey)) || (want && norm(r.Company) === want))
    .map((r) => ({
      id: String(r.id),
      company: r.Company || '',
      name: [r.First_Name, r.Last_Name].filter(Boolean).join(' '),
      phone: r.Phone || r.Mobile || '',
      status: r.Lead_Status || '',
    }))
}

export function splitName(full) {
  const parts = trimmed(full).split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: '', lastName: parts[0] }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

// POST /crm/v2/Leads body for a promoted prospect.
export function buildPromotedLead({ business, contactName, role, phone, email, address }) {
  const company = trimmed(business)
  if (!company) throw new Error('A Zoho lead needs a company')
  const { firstName, lastName } = splitName(contactName)
  const lead = {}
  if (firstName) lead.First_Name = firstName
  lead.Last_Name = lastName || company
  lead.Company = company
  if (trimmed(phone)) lead.Phone = trimmed(phone)
  if (trimmed(email)) lead.Email = trimmed(email)
  if (trimmed(role)) lead.Designation = trimmed(role)
  if (trimmed(address)) lead.Description = `Address: ${trimmed(address)}`
  lead.Lead_Status = 'Open'
  lead.Lead_Source = 'Chandler'
  lead.MPG_REP = 'Chandler'
  return { data: [lead] }
}
