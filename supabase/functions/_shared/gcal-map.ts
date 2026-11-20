// Pure mapping + diff for the Google Calendar push (gcal-push). No I/O here so
// it can be unit tested in vitest; the function does the HTTP.
//
// One contact_events row <-> one Google event. The Google event id is derived
// from the row id, so a retry or a lost response can never create a duplicate,
// and every event we own is tagged with a private extended property so a list
// call only ever sees (and only ever deletes) Sales OS events, never anything
// Chandler added to that calendar by hand.

export const SOURCE_TAG = 'sales-os'
export const TIME_ZONE = 'America/Chicago'
// Refuse to delete everything when the DB read comes back empty but Google
// still has more than this many of our events: an empty read that looks like
// "you canceled everything" is the failure we guard against, not a real state.
export const MASS_DELETE_GUARD = 5

const KIND_LABEL: Record<string, string> = { call: 'Call', meeting: 'Meeting', follow_up: 'Follow-up' }
const BOOK_LABEL: Record<string, string> = { bay: 'Bayway', mpg: 'MPG' }
// Google event colors: 10 = Basil (green, Bayway), 9 = Blueberry (blue, MPG).
const BOOK_COLOR: Record<string, string> = { bay: '10', mpg: '9' }

export interface ContactEventRow {
  id: string
  business_id: string
  kind: string
  starts_at: string
  duration_min: number
  note?: string | null
  remind_min?: number | null
  status: string
  contacts?: { name?: string | null; phone?: string | null; email?: string | null } | null
}

export interface GoogleEventLite {
  id: string
  start?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

// Google ids allow only base32hex (0-9, a-v), 5-1024 chars. A uuid's hex digits
// are a subset, so strip the dashes and prefix 'sos'.
export function googleEventId(rowId: string): string {
  const hex = String(rowId || '').toLowerCase().replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a uuid: ${rowId}`)
  return `sos${hex}`
}

// FNV-1a, enough to tell "this event changed" without storing a copy.
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Rows that belong on Google. Canceled ones come off; done ones stay, since
// the call still happened at that time.
export const wantsEvent = (row: ContactEventRow) => row.status === 'scheduled' || row.status === 'done'

export function toGoogleEvent(row: ContactEventRow) {
  const name = row.contacts?.name?.trim() || 'Contact'
  const kind = KIND_LABEL[row.kind] || 'Event'
  const book = BOOK_LABEL[row.business_id] || row.business_id
  const start = new Date(row.starts_at)
  if (Number.isNaN(start.getTime())) throw new Error(`bad starts_at on ${row.id}`)
  const end = new Date(start.getTime() + (Number(row.duration_min) || 30) * 60_000)

  const lines = []
  if (row.note) lines.push(row.note)
  if (row.contacts?.phone) lines.push(`Phone: ${row.contacts.phone}`)
  if (row.contacts?.email) lines.push(`Email: ${row.contacts.email}`)
  lines.push(`${book} · added from Sales OS`)

  const content = {
    summary: `${row.status === 'done' ? '✓ ' : ''}${kind}: ${name} (${book})`,
    description: lines.join('\n'),
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
    colorId: BOOK_COLOR[row.business_id],
    reminders: {
      useDefault: false,
      overrides: row.remind_min == null ? [] : [{ method: 'popup', minutes: Number(row.remind_min) }],
    },
  }
  const hash = hashString(JSON.stringify(content))
  return {
    id: googleEventId(row.id),
    status: 'confirmed',
    ...content,
    extendedProperties: { private: { source: SOURCE_TAG, contact_event_id: row.id, hash } },
  }
}

export type GoogleEventBody = ReturnType<typeof toGoogleEvent>

// rows: contact_events in [windowStart, windowEnd). existing: our tagged Google
// events listed over the same window. Returns what to create, update, delete.
export function planSync(
  rows: ContactEventRow[],
  existing: GoogleEventLite[],
  windowStart: number,
  windowEnd: number,
) {
  const desired = new Map<string, GoogleEventBody>()
  for (const r of rows) {
    if (!wantsEvent(r)) continue
    const ev = toGoogleEvent(r)
    desired.set(ev.id, ev)
  }
  const have = new Map(existing.map((e) => [e.id, e]))

  const creates: GoogleEventBody[] = []
  const updates: GoogleEventBody[] = []
  for (const [id, ev] of desired) {
    const cur = have.get(id)
    if (!cur) creates.push(ev)
    else if (cur.extendedProperties?.private?.hash !== ev.extendedProperties.private.hash) updates.push(ev)
  }

  // Only delete inside the window we read from the DB. Google's list matches
  // on overlap, so an event that starts just before the window can show up in
  // the list without its row having been read.
  const deletes = existing
    .filter((e) => !desired.has(e.id))
    .filter((e) => {
      const t = new Date(e.start?.dateTime || e.start?.date || '').getTime()
      return t >= windowStart && t < windowEnd
    })
    .map((e) => e.id)

  if (desired.size === 0 && deletes.length > MASS_DELETE_GUARD) {
    throw new Error(
      `refusing to delete ${deletes.length} Google events: Sales OS returned no events for the window`,
    )
  }
  return { creates, updates, deletes }
}

// Power Dialer callbacks (spec 2026-11-20): a dialer_calls row with outcome
// callback_requested becomes a 15-minute call event at callback_at, through
// the same planSync as contact_events. Its uuid is the event id, as above.
export interface DialerCallbackRow {
  id: string
  business_id: string
  callback_at: string
  notes?: string | null
  dialer_leads?: {
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    phone_e164?: string | null
    email?: string | null
  } | null
}

export function dialerCallbackEventRow(r: DialerCallbackRow): ContactEventRow {
  const l = r.dialer_leads || {}
  const person = [l.first_name, l.last_name].filter(Boolean).join(' ')
  return {
    id: r.id,
    business_id: r.business_id,
    kind: 'call',
    starts_at: r.callback_at,
    duration_min: 15,
    note: [`Power Dialer callback${person && l.company ? ` (${l.company})` : ''}`, r.notes].filter(Boolean).join(': '),
    remind_min: 10,
    status: 'scheduled',
    contacts: { name: person || l.company || null, phone: l.phone_e164 || null, email: l.email || null },
  }
}
