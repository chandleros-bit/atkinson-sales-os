// Inputs for the forecast (forecast.js): Arive loans and commission rates,
// the forecast settings, and the latest MPG residual / active merchants
// entered in Reports. One shared fetch for Overview and Pipeline.
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchLoanBundle } from './loansData'
import { DEFAULT_RATES } from './loans'
import { useLeadRatings } from './useLeadRatings'
import { resolveForecast, avgFundedLoan, mpgPerAccount, forecastLines } from './forecast'

const EMPTY = { loans: [], rates: DEFAULT_RATES, settings: resolveForecast(null), mpgMetrics: {}, at: 0, error: null }
let store = EMPTY
let inflight = null
const listeners = new Set()

export function __resetForecastForTest() {
  store = EMPTY
  inflight = null
}

export function refreshForecastInputs() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      const [bundle, settings, metrics] = await Promise.all([
        fetchLoanBundle(),
        supabase.from('settings').select('value').eq('key', 'forecast').maybeSingle(),
        supabase
          .from('metrics_daily')
          .select('date, metric_key, value')
          .eq('business_id', 'mpg')
          .in('metric_key', ['rev_monthly_residual', 'rev_active_merchants'])
          .order('date', { ascending: false })
          .limit(24),
      ])
      const latest = (key) => (metrics.data || []).find((m) => m.metric_key === key)?.value ?? null
      store = {
        loans: bundle.data?.loans || [],
        rates: bundle.data?.rates || DEFAULT_RATES,
        settings: resolveForecast(settings.data?.value),
        mpgMetrics: { residual: latest('rev_monthly_residual'), merchants: latest('rev_active_merchants') },
        at: Date.now(),
        error: bundle.error?.message || settings.error?.message || metrics.error?.message || null,
      }
    } finally {
      inflight = null
      listeners.forEach((fn) => fn(store))
    }
    return store
  })()
  return inflight
}

// -> { lines, settings, loading, error }
export function useForecast(now = Date.now()) {
  const [snap, setSnap] = useState(store)
  const ratings = useLeadRatings()
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshForecastInputs()
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
    return { lines, settings: snap.settings, loading: !snap.at && !isDemoMode, error: snap.error }
    // Recompute on new inputs or a new month, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, ratings, monthKey])
}
