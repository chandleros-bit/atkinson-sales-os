// Power Dialer CRM duplicate check (spec 2026-11-20, "Upload check"). Pure:
// COQL batching for Zoho and phone matching for both CRMs. Read only; no fetch.
//
// Zoho COQL (checked live 2026-11-20): at most 25 criteria in a WHERE, and
// more than two conditions must nest in pairs: ((a or b) or c). Phones are
// stored in any format, so each number is searched by its last 4 digits
// ("like '%0101'") and the real matches are picked by all 10 digits here.

export const COQL_MAX_CRITERIA = 25
export const COQL_LIMIT = 2000

// 10 digits of a US number (leading 1 dropped, extension ignored), or null.
export function tenDigits(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('1')) d = d.slice(1)
  return d.length >= 10 ? d.slice(0, 10) : null
}

export function nestOr(conds: string[]): string {
  if (!conds.length) throw new Error('nestOr needs at least one condition')
  return conds.slice(1).reduce((acc, c) => `(${acc} or ${c})`, conds[0])
}

const OWNER = 'Owner.first_name, Owner.last_name'
export const ZOHO_MODULES = [
  { module: 'Leads', fields: ['Phone', 'Mobile'], select: `id, Full_Name, Company, Phone, Mobile, Lead_Status, ${OWNER}` },
  { module: 'Contacts', fields: ['Phone', 'Mobile'], select: `id, Full_Name, Phone, Mobile, ${OWNER}` },
  { module: 'Accounts', fields: ['Phone'], select: `id, Account_Name, Phone, ${OWNER}` },
]

// One COQL per module per batch of last-4 tails, each under the criteria cap.
export function zohoDupQueries(phones: string[]): { module: string; query: string }[] {
  const tails = [...new Set(phones.map(tenDigits).filter(Boolean).map((d) => (d as string).slice(-4)))]
  const out: { module: string; query: string }[] = []
  for (const m of ZOHO_MODULES) {
    const per = Math.floor(COQL_MAX_CRITERIA / m.fields.length)
    for (let i = 0; i < tails.length; i += per) {
      const conds = tails.slice(i, i + per).flatMap((t) => m.fields.map((f) => `${f} like '%${t}'`))
      out.push({ module: m.module, query: `select ${m.select} from ${m.module} where ${nestOr(conds)} limit ${COQL_LIMIT}` })
    }
  }
  return out
}

export interface CrmMatch {
  crm: 'zoho' | 'fub'
  module: string
  id: string
  name: string | null
  owner: string | null
  status?: string | null
  contact_id?: string | null
}

const ownerName = (r: Record<string, unknown>) =>
  [r['Owner.first_name'], r['Owner.last_name']].filter(Boolean).join(' ') || null

// rows: one module's COQL rows. want: Map<10 digits, E.164>. Adds the first
// match per number to `into` (earlier modules win: Leads, Contacts, Accounts).
export function matchZohoRows(module: string, rows: Record<string, unknown>[], want: Map<string, string>, into: Record<string, CrmMatch>) {
  const fields = ZOHO_MODULES.find((m) => m.module === module)?.fields || ['Phone']
  for (const r of rows || []) {
    for (const f of fields) {
      const e164 = want.get(tenDigits(r[f]) || '')
      if (e164 && !into[e164]) {
        into[e164] = {
          crm: 'zoho',
          module,
          id: String(r.id),
          name: (r.Full_Name || r.Account_Name || r.Company || null) as string | null,
          owner: ownerName(r),
          status: (r.Lead_Status as string) || null,
        }
      }
    }
  }
  return into
}

// FUB people already synced into contacts (Phase 2): the main phone plus
// every number in the raw FUB phones list.
export function matchFubContacts(
  contacts: { id: string; external_id: string; name?: string | null; owner?: string | null; phone?: string | null; phones?: { value?: string }[] | null }[],
  want: Map<string, string>,
) {
  const into: Record<string, CrmMatch> = {}
  for (const c of contacts || []) {
    const nums = [c.phone, ...(Array.isArray(c.phones) ? c.phones.map((p) => p?.value) : [])]
    for (const n of nums) {
      const e164 = want.get(tenDigits(n) || '')
      if (e164 && !into[e164]) {
        into[e164] = { crm: 'fub', module: 'People', id: String(c.external_id), name: c.name || null, owner: c.owner || null, contact_id: c.id }
      }
    }
  }
  return into
}

// E.164 list -> Map<10 digits, E.164> (US numbers only; others cannot match).
export function wantMap(phones: string[]) {
  const m = new Map<string, string>()
  for (const p of phones || []) {
    if (/^\+1\d{10}$/.test(p)) m.set(p.slice(2), p)
  }
  return m
}
