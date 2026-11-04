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
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(store))

// Tests share module state across renders; reset between them.
export function __resetRatingsForTest() {
  store = { ratings: new Map(), at: 0, error: null }
  inflight = null
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

export function refreshRatings() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      const { data, error } = await fetchAllSettled(() =>
        supabase
          .from('lead_ratings')
          .select('contact_id, business_id, temperature, est_amount, close_month, rated_at, score_at_rating, contact:contacts(name, score, tier)')
          .order('contact_id'),
      )
      store = error ? { ...store, error: error.message, at: Date.now() } : { ratings: toRatingMap(data), error: null, at: Date.now() }
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
    if (Date.now() - store.at > STALE_MS) refreshRatings()
  })
}

// Map contact_id -> rating; re-renders when any rating is saved.
export function useLeadRatings() {
  const [snap, setSnap] = useState(store)
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshRatings()
    else setSnap(store)
    return () => listeners.delete(setSnap)
  }, [])
  return snap.ratings
}

// -> { ok: true } | { ok: true, tagError } (rating saved, FUB tag not) | { ok: false, error }
export async function saveRating({ contactId, businessId, temperature, estAmount = null, closeMonth = null }) {
  const row = {
    contact_id: contactId,
    business_id: businessId,
    temperature,
    est_amount: estAmount ?? null,
    close_month: closeMonth ?? null,
    rated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('lead_ratings').upsert(row, { onConflict: 'contact_id' })
  if (error) return { ok: false, error: error.message }
  const ratings = new Map(store.ratings)
  ratings.set(contactId, { ...(store.ratings.get(contactId) || {}), ...row })
  store = { ...store, ratings }
  emit()
  if (businessId !== 'bay') return { ok: true }
  const res = await invokeCrmAction(buildActionRequest({ action: 'set_temperature', contactId, temperature }))
  if (res?.status === 'ok') return { ok: true }
  return { ok: true, tagError: res?.error || res?.results?.find((r) => !r.ok)?.error || 'FUB tag not updated' }
}
