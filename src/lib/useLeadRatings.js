// One shared copy of lead_ratings (spec 2026-11-03, section 1) for every page
// that ranks or shows temperature: Up Next, the call list, Pipeline, the
// Person sheet and the forecast. saveRating writes the OS row first (the
// truth), then, for Bayway, the FUB Hot/Warm/Cold tag through crm-action.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { invokeCrmAction } from './writeback'
import { buildActionRequest } from './crmActions'

const STALE_MS = 60_000
let store = { ratings: new Map(), at: 0, error: null }
let inflight = null
// Bumped after every successful rating write. A refresh that started before a
// write may have read the table before it, so its result is thrown away.
let gen = 0
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(store))
// contact_id -> tail of that contact's save queue (see saveRating).
const saving = new Map()

// Tests share module state across renders; reset between them.
export function __resetRatingsForTest() {
  store = { ratings: new Map(), at: 0, error: null }
  inflight = null
  gen = 0
  saving.clear()
}

// rows: lead_ratings with contact:contacts(name, score, tier) embedded.
export function toRatingMap(rows) {
  return new Map(
    (rows || []).map((r) => [
      r.contact_id,
      { ...r, name: r.contact?.name ?? null, current_score: r.contact?.score ?? null, current_tier: r.contact?.tier ?? null },
    ]),
  )
}

const MAX_FETCHES = 5

export function refreshRatings() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      let res
      // A save landed while the fetch was in the air: that result may predate
      // it, so fetch again (bounded) before replacing the store.
      for (let i = 0; i < MAX_FETCHES; i++) {
        const started = gen
        res = await fetchAllSettled(() =>
          supabase
            .from('lead_ratings')
            .select('contact_id, business_id, temperature, est_amount, close_month, rated_at, score_at_rating, contact:contacts(name, score, tier)')
            .order('contact_id'),
        )
        if (res.error || started === gen) break
      }
      store = res.error ? { ...store, error: res.error.message, at: Date.now() } : { ratings: toRatingMap(res.data), error: null, at: Date.now() }
    } catch (e) {
      store = { ...store, error: String(e?.message || e), at: Date.now() }
    } finally {
      inflight = null
      emit()
    }
    return store
  })()
  return inflight
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (listeners.size > 0 && Date.now() - store.at > STALE_MS) refreshRatings().catch(() => {})
  })
}

// Map contact_id -> rating; re-renders when any rating is saved.
export function useLeadRatings() {
  const [snap, setSnap] = useState(store)
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshRatings().catch(() => {})
    else setSnap(store)
    return () => listeners.delete(setSnap)
  }, [])
  return snap.ratings
}

// -> { ok: true } | { ok: true, tagError } (rating saved, FUB tag not) | { ok: false, error }
//
// Partial updates: estAmount and closeMonth left undefined are not sent, so the
// saved value stays; null (or 0 for the amount) clears it. temperature and a
// fresh rated_at always go: the table's trigger re-snapshots score_at_rating
// whenever either changes.
//
// Saves for one contact run one after another. The FUB tag write is a
// read-then-PUT of the whole tag list, so two overlapping re-rates could land
// out of order and leave the older temperature on the lead.
export function saveRating(args) {
  const key = args.contactId
  const run = (saving.get(key) || Promise.resolve()).then(() => doSave(args))
  const tail = run.catch(() => {})
  saving.set(key, tail)
  tail.then(() => {
    if (saving.get(key) === tail) saving.delete(key)
  })
  return run
}

async function doSave({ contactId, businessId, temperature, estAmount, closeMonth }) {
  if (isDemoMode) return { ok: false, error: 'Demo mode' }
  const row = { contact_id: contactId, business_id: businessId, temperature, rated_at: new Date().toISOString() }
  if (estAmount !== undefined) row.est_amount = Number(estAmount) > 0 ? Number(estAmount) : null
  if (closeMonth !== undefined) row.close_month = closeMonth || null
  const { error } = await supabase.from('lead_ratings').upsert(row, { onConflict: 'contact_id' })
  if (error) return { ok: false, error: error.message }
  gen += 1
  const existing = store.ratings.get(contactId)
  const ratings = new Map(store.ratings)
  // The trigger just re-snapshotted score_at_rating to the contact's score.
  ratings.set(contactId, { ...(existing || {}), ...row, score_at_rating: existing?.current_score ?? null })
  store = { ...store, ratings }
  emit()
  refreshRatings().catch(() => {}) // not awaited: the server's copy lands when it lands
  if (businessId !== 'bay') return { ok: true }
  const res = await invokeCrmAction(buildActionRequest({ action: 'set_temperature', contactId, temperature }))
  if (res?.status === 'ok') return { ok: true }
  return { ok: true, tagError: res?.error || res?.results?.find((r) => !r.ok)?.error || 'FUB tag not updated' }
}
