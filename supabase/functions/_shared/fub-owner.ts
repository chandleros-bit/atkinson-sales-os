// Keep Atkinson Sales OS to Chandler's own FollowUpBoss book. His account is a
// FUB admin, so the API returns every agent's people and tasks; the syncs keep
// only records assigned to FUB_USER_ID (Chandler = 6, confirmed by crm-action's
// whoami) and remove ones assigned elsewhere. With FUB_USER_ID unset the filter
// is off and everything is kept, as before.

// env: (key) => string | undefined
export function myFubUserId(env) {
  const v = env('FUB_USER_ID')
  return v ? String(v) : null
}

// People and tasks both carry assignedUserId.
export function isMine(rec, myId) {
  if (!myId) return true
  return rec?.assignedUserId != null && String(rec.assignedUserId) === String(myId)
}

export function partitionByOwner(records, myId) {
  const mine = []
  const others = []
  for (const r of records || []) (isMine(r, myId) ? mine : others).push(r)
  return { mine, others }
}

const personIdOf = (rec) => {
  const id = rec?.personId ?? rec?.person?.id ?? null
  return id == null ? null : String(id)
}

// Person ids on activity records that our contact map (mine only) doesn't
// know: either someone else's lead, or one of mine the contact sync hasn't
// stored yet. The activity sync looks each one up once to tell them apart.
export function unresolvedPersonIds(records, contactIdByExternal) {
  const out = new Set()
  for (const r of records || []) {
    const pid = personIdOf(r)
    if (pid && !contactIdByExternal.has(pid)) out.add(pid)
  }
  return [...out]
}

// ownerByPersonId: Map<person id, assignedUserId as string> from those lookups.
// A failed lookup (no entry) keeps the record: losing my activity is worse
// than briefly holding someone else's, which the next contact pass removes.
export function keepActivityRecord(rec, contactIdByExternal, ownerByPersonId, myId) {
  if (!myId) return true
  const pid = personIdOf(rec)
  if (!pid || contactIdByExternal.has(pid)) return true
  if (!ownerByPersonId.has(pid)) return true
  return ownerByPersonId.get(pid) === String(myId)
}
