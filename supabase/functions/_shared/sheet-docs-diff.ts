import { ParsedRow, ParsedDoc } from './sheet-docs.ts'

export interface TrackingRow {
  fub_person_id: string
  notes: string
  removed_at: string | null
}

export interface TrackingRowActive {
  fub_person_id: string
  notes: string
  last_seen_at: string
  removed_at: null
}

export interface TrackingRowRemoved {
  fub_person_id: string
  notes: string
  removed_at: string
}

export interface TrackingDiff {
  active: TrackingRowActive[]
  removed: TrackingRowRemoved[]
}

export interface DocRow {
  doc_type: string
  status: 'needed' | 'received'
  first_requested_at: string | null
  received_at: string | null
  removed_at: string | null
}

export interface DocRowEmitted {
  fub_person_id: string
  doc_type: string
  status: 'needed' | 'received'
  first_requested_at: string | null
  received_at: string | null
  removed_at: string | null
}

// Tracking rows to upsert: everyone in the sheet (refreshing notes + last_seen),
// plus anyone who dropped out (stamped removed_at once, not on every run).
// Returns separate homogeneous lists for active and removed borrowers to avoid
// data corruption when heterogeneous objects are upserted to PostgREST, which
// would fill missing columns with NULL.
export function diffTracking(
  incoming: ParsedRow[],
  existing: TrackingRow[],
  nowIso: string,
): TrackingDiff {
  const seen = new Set(incoming.map((r) => r.fub_person_id))
  const active: TrackingRowActive[] = incoming.map((r) => ({
    fub_person_id: r.fub_person_id,
    notes: r.notes,
    last_seen_at: nowIso,
    removed_at: null,
  }))

  const removed: TrackingRowRemoved[] = []
  for (const e of existing) {
    if (seen.has(e.fub_person_id)) continue
    if (e.removed_at) continue // already gone; don't re-stamp
    removed.push({
      fub_person_id: e.fub_person_id,
      notes: e.notes,
      removed_at: nowIso,
    })
  }
  return { active, removed }
}

// Doc rows to upsert, keyed by fub_person_id — the caller resolves tracking_id
// after the tracking upsert, since new borrowers have no id yet.
// Only CHANGED rows are emitted: a 15-minute cron mostly sees no change, and
// re-upserting everything every cycle would churn updated_at for nothing.
export function diffDocs(
  incoming: ParsedRow[],
  existingByPerson: Map<string, DocRow[]>,
  nowIso: string,
): DocRowEmitted[] {
  const out: DocRowEmitted[] = []
  const incomingPeople = new Set(incoming.map((r) => r.fub_person_id))

  for (const person of incoming) {
    const prior = new Map((existingByPerson.get(person.fub_person_id) || []).map((d) => [d.doc_type, d]))
    const incomingTypes = new Set(person.docs.map((d) => d.doc_type))

    for (const doc of person.docs) {
      const was = prior.get(doc.doc_type)
      let first_requested_at = was?.first_requested_at ?? null
      let received_at = was?.received_at ?? null

      if (doc.status === 'needed') {
        // New, or re-opened after having been received: start a fresh clock.
        if (!was || was.status === 'received' || !first_requested_at) first_requested_at = nowIso
        received_at = null
      } else {
        if (!was || was.status === 'needed') received_at = nowIso
      }

      const unchanged =
        was &&
        was.status === doc.status &&
        was.first_requested_at === first_requested_at &&
        was.received_at === received_at &&
        was.removed_at === null
      if (unchanged) continue

      out.push({
        fub_person_id: person.fub_person_id,
        doc_type: doc.doc_type,
        status: doc.status,
        first_requested_at,
        received_at,
        removed_at: null,
      })
    }

    // Doc column disappeared from the sheet: soft-delete, never hard-delete.
    for (const [type, was] of prior) {
      if (incomingTypes.has(type) || was.removed_at) continue
      out.push({
        fub_person_id: person.fub_person_id,
        doc_type: type,
        status: was.status,
        first_requested_at: was.first_requested_at,
        received_at: was.received_at,
        removed_at: nowIso,
      })
    }
  }

  // FIX 2: Soft-remove docs for borrowers who dropped out entirely (not in incoming).
  for (const [personId, docs] of existingByPerson) {
    if (incomingPeople.has(personId)) continue
    for (const doc of docs) {
      if (doc.removed_at) continue // already removed; don't re-stamp
      out.push({
        fub_person_id: personId,
        doc_type: doc.doc_type,
        status: doc.status,
        first_requested_at: doc.first_requested_at,
        received_at: doc.received_at,
        removed_at: nowIso,
      })
    }
  }

  return out
}

// THE critical safety property of this sync.
//
// A sheet legitimately emptying overnight is not a real scenario. An auth
// failure, a renamed tab, or a revoked share IS. Without this guard, any of
// those stamps removed_at across every borrower and flips every card to "not
// tracked" — while the run logs ok. Arive has no API, so there is no second
// source that would ever correct it.
//
// Deliberately narrow: only a TOTAL wipe aborts. A drop from 500 to 1 is
// unusual but could be real, and blocking legitimate edits would train whoever
// maintains the sheet to ignore the alarm.
export function assertNotMassRemoval(incomingCount: number, previousCount: number) {
  if (incomingCount === 0 && previousCount > 0) {
    throw new Error(
      `refusing to apply an empty sheet: ${previousCount} borrowers are currently tracked. ` +
        `Check that the "Doc Status" tab exists and is still shared with the service account.`,
    )
  }
}
