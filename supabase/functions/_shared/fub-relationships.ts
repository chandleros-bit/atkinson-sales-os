// FUB Relationships -> contact_relationships rows (dialer phase 3: the
// buyer's and seller's agents on a Bayway borrower). Chandler enters them on
// the borrower in FUB; the type is free text, so it's read loosely. Only the
// two agent kinds are kept.
//
// VERIFY on the first live run: GET /peopleRelationships?personId= returns
// { peopleRelationships: [{ id, personId, type, firstName, lastName, phones,
// emails }] }. relationshipsOf / mapRelationship accept the likely variants.

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
  const kind = relationshipKind(rec?.type)
  if (!kind || rec?.id == null) return null
  const name = [rec.firstName, rec.lastName].filter(Boolean).join(' ').trim() || rec.name || null
  return {
    contact_id: contactId,
    external_id: String(rec.id),
    kind,
    type: rec.type,
    name,
    phone: pick(rec.phones) || rec.phone || null,
    email: pick(rec.emails) || rec.email || null,
  }
}

export function relationshipsOf(json) {
  for (const k of ['peopleRelationships', 'relationships']) {
    if (Array.isArray(json?.[k])) return json[k]
    if (Array.isArray(json?._embedded?.[k])) return json._embedded[k]
  }
  return []
}
