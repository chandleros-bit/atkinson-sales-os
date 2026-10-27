// Latest sync_log row per core feed, for the page header's sync dot. One
// shared fetch for every page header; refetched when older than a minute
// (page change, window focus). The dot's text ages with useNow.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { CORE_SOURCES } from './syncHealth'

const STALE_MS = 60_000
let store = { latest: null, at: 0 }
let inflight = null
const listeners = new Set()

export function refreshSyncHealth() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      // One small query per feed: FUB logs every 2 minutes and would crowd
      // the 15-minute feeds out of a single recent-rows query.
      const results = await Promise.all(
        CORE_SOURCES.map(({ source }) =>
          supabase.from('sync_log').select('source, ran_at, status').eq('source', source).order('ran_at', { ascending: false }).limit(1).maybeSingle(),
        ),
      )
      // A failed read leaves the last answer in place; the dot just doesn't update.
      if (results.every((r) => !r.error)) {
        const latest = {}
        results.forEach((r, i) => {
          if (r.data) latest[CORE_SOURCES[i].source] = r.data
        })
        store = { latest, at: Date.now() }
        listeners.forEach((fn) => fn(store))
      }
      return store
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useSyncHealth() {
  const [state, setState] = useState(store)
  useEffect(() => {
    listeners.add(setState)
    const maybeRefresh = () => {
      if (Date.now() - store.at > STALE_MS) refreshSyncHealth()
    }
    maybeRefresh()
    window.addEventListener('focus', maybeRefresh)
    return () => {
      listeners.delete(setState)
      window.removeEventListener('focus', maybeRefresh)
    }
  }, [])
  return state.latest
}
