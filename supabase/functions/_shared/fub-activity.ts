// FollowUpBoss activity fetchers + field mapping for the scheduled activity
// sync. Pulls the five human-touch activity types and normalizes each into an
// `activities` row (business_id 'bay', source_crm 'fub').
//
// VERIFY BEFORE FIRST REAL RUN (same convention as fub.ts): the list-endpoint
// paths, their response list keys, and the per-type date/body field names below
// are written from FollowUpBoss's documented API shape and should be checked
// against a live response and adjusted here. The sync function logs raw payload
// shape to sync_log.message on error to make that first-pass adjustment fast.

import { fubGet } from './fub.ts'

// Paginate a FUB activity list endpoint. `listKeys` are candidate top-level
// array keys (FUB casing varies by resource); the first present wins.
async function fubListActivity(path, listKeys, sinceIso, extraParams = {}) {
  const limit = 100
  let offset = 0
  const items = []
  const pick = (json) => {
    for (const k of listKeys) {
      if (Array.isArray(json[k])) return json[k]
      if (Array.isArray(json._embedded?.[k])) return json._embedded[k]
    }
    return []
  }
  while (true) {
    const params = { limit, offset, sort: 'updated', ...extraParams }
    if (sinceIso) params.updatedAfter = sinceIso
    const json = await fubGet(path, params)
    const page = pick(json)
    if (page.length === 0) break
    items.push(...page)
    if (page.length < limit) break
    offset += limit
  }
  return items
}

export const fetchCalls = (since) => fubListActivity('/calls', ['calls'], since)
export const fetchTexts = (since) => fubListActivity('/textMessages', ['textMessages', 'textmessages'], since)
export const fetchNotes = (since) => fubListActivity('/notes', ['notes'], since)
export const fetchAppointments = (since) => fubListActivity('/appointments', ['appointments'], since)

export const fetchEmails = (since) => fubListActivity('/emails', ['emails', 'emailEvents'], since)

// Emails don't list account-wide (FUB 400s without a person filter), so they
// are fetched per contact by personId. VERIFY on first run: confirm the list
// key ('emails') and that `personId` is the accepted filter param for /emails.
// See docs/phase-priority-leads-setup.md.
export const fetchEmailsForContact = (personId, since) =>
  fubListActivity('/emails', ['emails', 'emailEvents'], since, { personId })

// --- Pure mapping helpers (unit-tested) ------------------------------------

const OCCURRED_FIELDS = {
  call: ['created'],
  text: ['created', 'sent'],
  email: ['created', 'sent'],
  note: ['created'],
  appointment: ['date', 'start', 'created'],
}

export function occurredAt(rec, type) {
  const order = OCCURRED_FIELDS[type] || ['created']
  for (const k of order) {
    if (rec[k]) return rec[k]
  }
  return null
}

export function snippet(rec, type) {
  switch (type) {
    case 'call':
      return rec.note || rec.outcome || (rec.duration ? `Call · ${rec.duration}s` : 'Call')
    case 'text':
      return rec.message || rec.body || 'Text'
    case 'email':
      return rec.subject || rec.body || 'Email'
    case 'note':
      return rec.body || rec.subject || 'Note'
    case 'appointment':
      return rec.title || rec.description || 'Appointment'
    default:
      return null
  }
}

// contactIdByExternal: Map<fub person id (string), our contacts.id (uuid)>
export function mapActivity(rec, type, contactIdByExternal) {
  const personId = rec.personId ?? rec.person?.id ?? null
  return {
    business_id: 'bay',
    source_crm: 'fub',
    // Namespaced so numeric ids reused across endpoints don't collide under
    // the unique(source_crm, external_id) constraint on `activities`.
    external_id: `${type}-${rec.id}`,
    type,
    contact_id: (personId != null && contactIdByExternal.get(String(personId))) || null,
    occurred_at: occurredAt(rec, type),
    notes: snippet(rec, type),
    raw: rec,
  }
}
