// One shared fetch of the Up Next inputs (v_lead_signals, the priority_rules
// setting, today's touches) for the page, the sidebar badge and the Overview
// card, so all three always agree. Refreshes on window focus (when older than
// a minute), after a snooze, and after any Quick Action (crm-action:done).
// Business filtering happens here on the shared rows, not per query.
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { buildQueue, resolveRules } from './priorityQueue'

const STALE_MS = 60_000
let store = { rows: [], rules: resolveRules(null), touched: [], loading: !isDemoMode, error: null, at: 0 }
let inflight = null
const listeners = new Set()

const emit = () => listeners.forEach((fn) => fn(store))

function startOfTodayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function refreshPriorityQueue() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      const [signals, settings, touched] = await Promise.all([
        fetchAllSettled(() => supabase.from('v_lead_signals').select('*').order('id')),
        supabase.from('settings').select('value').eq('key', 'priority_rules').maybeSingle(),
        supabase
          .from('activities')
          .select('contact_id, business_id')
          .gte('occurred_at', startOfTodayIso())
          .or('and(type.eq.call,direction.eq.outbound),type.eq.note'),
      ])
      const error = signals.error || settings.error || touched.error
      store = error
        ? { ...store, loading: false, error: error.message, at: Date.now() }
        : {
            rows: signals.data || [],
            rules: resolveRules(settings.data?.value),
            touched: touched.data || [],
            loading: false,
            error: null,
            at: Date.now(),
          }
    } catch (e) {
      store = { ...store, loading: false, error: String(e?.message || e), at: Date.now() }
    } finally {
      inflight = null
      emit()
    }
    return store
  })()
  return inflight
}

if (typeof window !== 'undefined') {
  window.addEventListener('crm-action:done', () => refreshPriorityQueue())
  window.addEventListener('focus', () => {
    if (Date.now() - store.at > STALE_MS) refreshPriorityQueue()
  })
}

// biz: 'all' | 'bay' | 'mpg'. Returns the ranked queue for that view plus
// the day's touched count (distinct leads in the candidate set).
export function usePriorityQueue(biz = 'all') {
  const [snap, setSnap] = useState(store)
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshPriorityQueue()
    else setSnap(store)
    // Keep new leads and callbacks current while the app is on screen.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - store.at >= STALE_MS) refreshPriorityQueue()
    }, STALE_MS)
    return () => {
      clearInterval(id)
      listeners.delete(setSnap)
    }
  }, [])

  return useMemo(() => {
    const inView = (r) => biz === 'all' || r.business_id === biz
    const rows = snap.rows.filter(inView)
    const ids = new Set(rows.map((r) => r.id))
    const touchedToday = new Set(snap.touched.filter((t) => inView(t) && ids.has(t.contact_id)).map((t) => t.contact_id)).size
    return {
      queue: buildQueue(rows, snap.rules, Date.now()),
      rules: snap.rules,
      touchedToday,
      loading: snap.loading,
      error: snap.error,
      refresh: refreshPriorityQueue,
    }
  }, [snap, biz])
}
