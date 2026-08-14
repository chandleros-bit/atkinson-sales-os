// Zoho CRM (MPG) ACTIVITY fetchers + field mapping for the scheduled MPG
// activity sync. Pulls the three Zoho activity modules that map onto the feed's
// human-touch types — Calls, Events (meetings), Notes — and normalizes each
// into an `activities` row (business_id 'mpg', source_crm 'zoho'). Read-only:
// only GETs from Zoho. Mirrors the Bayway side (fub-activity.ts).
//
// Zoho has no first-class Text/Email list module the way FUB does, so MPG's
// feed carries call / appointment / note. The Activity screen already tolerates
// a partial type set (the type chips just show empty for missing kinds).
//
// VERIFY BEFORE FIRST REAL RUN (same convention as zoho.ts / zoho-tasks.ts):
// the module api names ('Calls', 'Events', 'Notes'), the datetime field names
// below, and that Who_Id (Calls/Events) and Parent_Id + $se_module (Notes)
// carry the ids used to resolve the contact. See docs/phase-activity-zoho-setup.md.

import { zohoList } from './zoho.ts'

export const fetchCalls = (apiHost, token, since) => zohoList(apiHost, token, 'Calls', since)
export const fetchEvents = (apiHost, token, since) => zohoList(apiHost, token, 'Events', since)
export const fetchNotes = (apiHost, token, since) => zohoList(apiHost, token, 'Notes', since)

// --- Pure mapping helpers (unit-tested) ------------------------------------

const OCCURRED_FIELDS = {
  call: ['Call_Start_Time', 'Created_Time'],
  appointment: ['Start_DateTime', 'Created_Time'],
  note: ['Created_Time', 'Modified_Time'],
}

export function occurredAt(rec, type) {
  const order = OCCURRED_FIELDS[type] || ['Created_Time']
  for (const k of order) {
    if (rec[k]) return rec[k]
  }
  return null
}

export function snippet(rec, type) {
  switch (type) {
    case 'call':
      return (
        rec.Description ||
        rec.Subject ||
        rec.Call_Purpose ||
        (rec.Call_Duration ? `Call · ${rec.Call_Duration}` : 'Call')
      )
    case 'appointment':
      return rec.Event_Title || rec.Subject || rec.Title || 'Meeting'
    case 'note':
      return rec.Note_Content || rec.Note_Title || 'Note'
    default:
      return null
  }
}

const PERSON_MODULES = new Set(['Contacts', 'Leads'])

// The Zoho record whose id should resolve to our contact, for a Call / Event.
// Zoho splits the association by module: a call on a Contact carries the person
// in Who_Id, but a call on a Lead carries it in What_Id with $se_module 'Leads'
// (Who_Id is null). MPG's book lives on Leads, so What_Id is the common case.
// What_Id is polymorphic (Deals/Accounts too), so trust it only for a person
// module. Who_Id wins when both are present.
function personExternalId(rec) {
  if (rec.Who_Id && rec.Who_Id.id) return String(rec.Who_Id.id)
  const se = rec['$se_module']
  if (PERSON_MODULES.has(se) && rec.What_Id && rec.What_Id.id) return String(rec.What_Id.id)
  return null
}

// The Zoho record whose id should resolve to our contact.
// Notes attach to a polymorphic parent — link only when that parent is a person
// module; a note on a Deal/Account has no contact to point at. Calls / Events
// use personExternalId (Who_Id, or a Lead in What_Id).
export function contactExternalId(rec, type) {
  if (type === 'note') {
    const pid = rec.Parent_Id && rec.Parent_Id.id ? String(rec.Parent_Id.id) : null
    if (!pid) return null
    const se = rec['$se_module']
    if (se && !PERSON_MODULES.has(se)) return null
    return pid
  }
  return personExternalId(rec)
}

// Direction of a Zoho call. Zoho Calls carry `Call_Type`, whose value may be
// 'Outbound'/'Inbound' or 'Outbound Call'/'Inbound Call' depending on layout,
// so match on a case-insensitive prefix. VERIFY the field name and value casing
// against a live Calls record; an unrecognized value returns null (excluded
// from the outbound count, failing safe).
export function callDirection(rec) {
  const t = String(rec.Call_Type || '').toLowerCase()
  if (t.startsWith('outbound')) return 'outbound'
  if (t.startsWith('inbound')) return 'inbound'
  return null
}

// contactIdByExternal: Map<zoho record id (string), our contacts.id (uuid)>
export function mapActivity(rec, type, contactIdByExternal) {
  const ext = contactExternalId(rec, type)
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    // Namespaced so ids reused across modules can't collide under the unique
    // (source_crm, external_id) constraint on `activities` (same as fub side).
    external_id: `${type}-${rec.id}`,
    type,
    direction: type === 'call' ? callDirection(rec) : null,
    contact_id: (ext && contactIdByExternal.get(ext)) || null,
    occurred_at: occurredAt(rec, type),
    notes: snippet(rec, type),
    raw: rec,
  }
}
