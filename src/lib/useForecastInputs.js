// Inputs for the forecast (forecast.js): Arive loans and commission rates,
// the forecast settings, and the latest MPG residual / active merchants
// entered in Reports. One shared fetch for Overview and Pipeline.
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchLoanBundle } from './loansData'
import { DEFAULT_RATES } from './loans'
import { useLeadRatings, useLeadRatingsStatus } from './useLeadRatings'
import { resolveForecast, avgFundedLoan, mpgPerAccount, forecastLines, latestMpgMetrics } from './forecast'
import { friendlyError } from './friendlyError'

const EMPTY = { loans: [], rates: DEFAULT_RATES, settings: resolveForecast(null), mpgMetrics: {}, at: 0, error: null }
let store = EMPTY
let inflight = null
// Set when a refresh is asked for while one is in the air: that fetch may have
// read before whatever prompted the new request, so the run goes round again.
let dirty = false
const listeners = new Set()
const MAX_FETCHES = 5
const STALE_MS = 60_000

export function __resetForecastForTest() {
  store = EMPTY
  inflight = null
  dirty = false
}

// A thrown query becomes a { data: null, error } like a failed one, so the
// other queries' results are still used.
const settle = (p) => Promise.resolve(p).then((v) => v, (e) => ({ data: null, error: { message: friendlyError(e) } }))

// One pass over all three sources. A source that failed leaves its part of the
// store as it was; every failure message lands in `error`.
async function loadOnce() {
  const [bundle, settings, metrics] = await Promise.all([
    settle(fetchLoanBundle()),
    settle(supabase.from('settings').select('value').eq('key', 'forecast').maybeSingle()),
    settle(
      supabase
        .from('metrics_daily')
        .select('date, metric_key, value')
        .eq('business_id', 'mpg')
        .in('metric_key', ['rev_monthly_residual', 'rev_active_merchants'])
        .order('date', { ascending: false })
        .limit(120),
    ),
  ])
  const bundleOk = !bundle?.error && !!bundle?.data
  const errors = [bundle?.error, settings.error, metrics.error].filter(Boolean).map((e) => e.message || String(e))
  if (!bundle?.error && !bundle?.data) errors.push('Loans did not load')
  store = {
    loans: bundleOk ? bundle.data.loans || [] : store.loans,
    rates: bundleOk ? bundle.data.rates || DEFAULT_RATES : store.rates,
    settings: settings.error ? store.settings : resolveForecast(settings.data?.value),
    mpgMetrics: metrics.error ? store.mpgMetrics : latestMpgMetrics(metrics.data),
    at: Date.now(),
    error: errors.length ? errors.join('; ') : null,
  }
}

// Resolves with the store once the fetch is done; a call made while a fetch is
// in flight queues one more fetch and resolves after that one.
export function refreshForecastInputs() {
  if (isDemoMode) return Promise.resolve(store)
  if (inflight) {
    dirty = true
    return inflight
  }
  inflight = (async () => {
    try {
      for (let i = 0; i < MAX_FETCHES; i++) {
        dirty = false
        await loadOnce()
        if (!dirty) break
      }
    } catch (e) {
      store = { ...store, error: friendlyError(e), at: Date.now() }
    } finally {
      inflight = null
      dirty = false
      listeners.forEach((fn) => fn(store))
    }
    return store
  })()
  return inflight
}

// Loans, rates and metrics change outside this tab (Arive import, Reports):
// a page left open refetches when the window regains focus after a minute.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (listeners.size > 0 && Date.now() - store.at > STALE_MS) refreshForecastInputs().catch(() => {})
  })
}

// -> { lines, settings, loading, error }
export function useForecast(now = Date.now()) {
  const [snap, setSnap] = useState(store)
  const ratings = useLeadRatings()
  const ratingsStatus = useLeadRatingsStatus()
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshForecastInputs().catch(() => {})
    else setSnap(store)
    return () => listeners.delete(setSnap)
  }, [])
  const monthKey = new Date(now).getMonth()
  return useMemo(() => {
    const lines = forecastLines({
      ratings,
      loans: snap.loans,
      rates: snap.rates,
      settings: snap.settings,
      avgLoan: avgFundedLoan(snap.loans, now),
      mpgAccount: mpgPerAccount(snap.mpgMetrics, snap.settings),
      now,
    })
    return {
      lines,
      settings: snap.settings,
      loading: (!snap.at && !isDemoMode) || ratingsStatus.loading,
      error: snap.error || ratingsStatus.error,
    }
    // Recompute on new inputs or a new month, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, ratings, ratingsStatus.loading, ratingsStatus.error, monthKey])
}
