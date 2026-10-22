// A Bayway lead's first note: what the lead source told us ("Credit: 660-699 /
// loan type: DSCR Purchase / …"), shown on the Workbench's call rows as a
// quick read before the call. The activity sync only pulls notes for recently
// touched leads, and providers sometimes send these details as the lead's
// first event rather than a note, so fub-sync fetches it once per lead here.
// Read-only against FUB (GETs only).
// See docs/superpowers/specs/2026-10-22-workbench-design.md.

const MAX_LEN = 1000

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

// Note bodies can be HTML: keep line breaks, drop tags, decode entities.
export function cleanNoteText(raw) {
  const text = String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return text.slice(0, MAX_LEN)
}

const time = (rec) => Date.parse(rec?.created || rec?.createdAt || '') || Infinity

function earliest(records, textOf) {
  return (records || [])
    .map((r) => ({ text: cleanNoteText(textOf(r)), at: r.created || r.createdAt || null, t: time(r) }))
    .filter((r) => r.text)
    .sort((a, b) => a.t - b.t)[0]
}

// The earliest note with text; with no notes, the earliest event's message.
// { text, at } or null.
export function pickFirstNote(notes, events) {
  const n = earliest(notes, (r) => r.body ?? r.text ?? r.subject)
  const e = n ? null : earliest(events, (r) => r.message || r.description)
  const hit = n || e
  return hit ? { text: hit.text, at: hit.at } : null
}

const listOf = (json, key) => (Array.isArray(json?.[key]) ? json[key] : Array.isArray(json?._embedded?.[key]) ? json._embedded[key] : [])

// get: (path, params) => json (fubGet). Events are only read when there are no notes.
export async function fetchFirstNote(personId, get) {
  const notes = listOf(await get('/notes', { personId, sort: 'created', limit: 10 }), 'notes')
  if (notes.length) return pickFirstNote(notes, [])
  const events = listOf(await get('/events', { personId, sort: 'created', limit: 10 }), 'events')
  return pickFirstNote([], events)
}

// Up to `max` leads from first_note_candidates() (migration 0040): fetch each
// one's first note and stamp the check. A lead that fails is left unstamped
// and tried again next run; it never fails the sync.
export async function backfillFirstNotes(db, get, { max = 30, now = new Date() } = {}) {
  const { data, error } = await db.rpc('first_note_candidates', { max_rows: max })
  if (error) throw new Error(`first-note candidates: ${error.message}`)
  let checked = 0
  let found = 0
  for (const c of data || []) {
    try {
      const first = await fetchFirstNote(c.external_id, get)
      const patch = first
        ? { first_note: first.text, first_note_at: first.at, first_note_checked_at: now.toISOString() }
        : { first_note_checked_at: now.toISOString() }
      const { error: e } = await db.from('contacts').update(patch).eq('id', c.id)
      if (e) continue
      checked += 1
      if (first) found += 1
    } catch {
      // Retried next run.
    }
  }
  return { checked, found }
}
