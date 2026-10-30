// FUB Relationships -> contact_relationships rows (dialer phase 3: the
// buyer's and seller's agents on a Bayway borrower). Chandler enters them on
// the borrower in FUB; the type is free text, so it's read loosely. Only the
// two agent kinds are kept.
//
// GET /peopleRelationships?personId= returns { _metadata, peoplerelationships:
// [...] } (seen live). VERIFY the record fields on the first real agent:
// { id, personId, type, firstName, lastName, phones, emails } is assumed.

export function relationshipKind(type) {
  const t = String(type || '').toLowerCase().replace(/[’']/g, '')
  if (!/\b(agent|realtor)\b/.test(t)) return null
  if (/\b(buyers?|buying)\b/.test(t)) return 'buyer_agent'
  if (/\b(sellers?|selling|listing)\b/.test(t)) return 'seller_agent'
  return null
}

const pick = (list) => {
  const arr = Array.isArray(list) ? list.filter((x) => x?.value) : []
  return (arr.find((x) => x.isPrimary) || arr[0])?.value || null
}

export function mapRelationship(rec, contactId) {
  const type = rec?.type ?? rec?.relationship ?? rec?.relationshipType
  const kind = relationshipKind(type)
  if (!kind || rec?.id == null) return null
  const name = [rec.firstName, rec.lastName].filter(Boolean).join(' ').trim() || rec.name || null
  return {
    contact_id: contactId,
    external_id: String(rec.id),
    kind,
    type,
    name,
    phone: pick(rec.phones) || rec.phone || null,
    email: pick(rec.emails) || rec.email || null,
  }
}

// The list from a GET /peopleRelationships reply. An unknown shape throws, so
// it can't pass for "no agents recorded".
// FUB answers with the key in lower case (`peoplerelationships`), so keys are
// matched case-insensitively.
export function relationshipsOf(json) {
  for (const obj of [json, json?._embedded]) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (['peoplerelationships', 'relationships'].includes(k.toLowerCase()) && Array.isArray(v)) return v
    }
  }
  throw new Error(`FUB /peopleRelationships: unexpected reply (keys: ${Object.keys(json || {}).join(', ') || 'none'})`)
}
