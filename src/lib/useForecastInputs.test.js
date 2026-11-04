// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = {
  bundle: null, // () => Promise<{ data, error }>
  bundleCalls: 0,
  settings: { data: null, error: null },
  metrics: { data: [], error: null },
  ratings: new Map(),
  demo: false,
}
vi.mock('./supabase', () => ({
  get isDemoMode() {
    return state.demo
  },
  supabase: {
    from: (table) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: async () => state.metrics,
        maybeSingle: async () => {
          if (table !== 'settings') throw new Error(`unexpected maybeSingle on ${table}`)
          return state.settings
        },
      }
      return q
    },
  },
}))
vi.mock('./loansData', () => ({
  fetchLoanBundle: () => {
    state.bundleCalls += 1
    return state.bundle(state.bundleCalls)
  },
}))
vi.mock('./useLeadRatings', () => ({
  useLeadRatings: () => state.ratings,
  useLeadRatingsStatus: () => ({ loading: false, error: null }),
}))

const { useForecast, refreshForecastInputs, __resetForecastForTest } = await import('./useForecastInputs')

const NOW = new Date('2026-11-03T09:00:00').getTime()
const loan = (o) => ({ id: 1, role: 'primary', amount: 400000, stage_group: 'processing', funded_on: null, firm_closing_on: '2026-11-20', contact_id: null, borrower_name: 'B', comp_override: null, scenario_auto: false, scenario_override: null, ...o })
const ok = (loans) => ({ data: { loans, rates: { primary_pct: 1.25, assisted_pct: 0.75 }, lastImport: null }, error: null })
const tick = () => new Promise((r) => setTimeout(r, 0))

// Mount the real hook, let the shared fetch settle, return the last result.
async function readForecast() {
  let seen
  const Probe = () => {
    seen = useForecast(NOW)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(React.createElement(Probe)))
  await act(async () => { await tick() })
  const out = seen
  await act(async () => root.unmount())
  return out
}

beforeEach(() => {
  state.bundle = async () => ok([loan({})])
  state.bundleCalls = 0
  state.settings = { data: null, error: null }
  state.metrics = { data: [], error: null }
  state.ratings = new Map()
  state.demo = false
  __resetForecastForTest()
})

describe('useForecast', () => {
  it('turns loaded loans into lines and stops loading', async () => {
    const out = await readForecast()
    expect(out.loading).toBe(false)
    expect(out.error).toBe(null)
    expect(out.lines.map((l) => l.key)).toEqual(['loan:1'])
  })

  it('a thrown fetch on the first load sets the error and stops loading', async () => {
    state.bundle = async () => {
      throw new Error('boom')
    }
    const out = await readForecast()
    expect(out.loading).toBe(false)
    expect(out.error).toBe('boom')
    expect(out.lines).toEqual([])
  })

  it('a thrown refresh keeps the data it already had', async () => {
    await refreshForecastInputs()
    state.bundle = async () => {
      throw new Error('boom')
    }
    await refreshForecastInputs()
    const out = await readForecast()
    expect(out.error).toBe('boom')
    expect(out.loading).toBe(false)
    expect(out.lines.map((l) => l.key)).toEqual(['loan:1'])
  })

  it('a failed settings or metrics query keeps the loans and the settings it had', async () => {
    state.settings = { data: { value: { temp_odds: { hot: 70 } } }, error: null }
    await refreshForecastInputs()
    state.settings = { data: null, error: { message: 'settings down' } }
    state.metrics = { data: null, error: { message: 'metrics down' } }
    await refreshForecastInputs()
    const out = await readForecast()
    expect(out.error).toBe('settings down; metrics down')
    expect(out.lines.map((l) => l.key)).toEqual(['loan:1'])
    expect(out.settings.temp_odds.hot).toBe(70)
  })

  it('a failed loan load keeps the old loans but still takes the new settings', async () => {
    await refreshForecastInputs()
    state.bundle = async () => ({ data: null, error: { message: 'loans down' } })
    state.settings = { data: { value: { temp_odds: { hot: 80 } } }, error: null }
    await refreshForecastInputs()
    const out = await readForecast()
    expect(out.error).toBe('loans down')
    expect(out.lines.map((l) => l.key)).toEqual(['loan:1'])
    expect(out.settings.temp_odds.hot).toBe(80)
  })

  it('a refresh asked for while one is in flight fetches again, and resolves after that', async () => {
    let release
    state.bundle = (n) => (n === 1 ? new Promise((resolve) => { release = () => resolve(ok([loan({ id: 1 })])) }) : Promise.resolve(ok([loan({ id: 2 })])))
    const first = refreshForecastInputs()
    await tick()
    const second = refreshForecastInputs()
    expect(state.bundleCalls).toBe(1)
    release()
    await second
    await first
    expect(state.bundleCalls).toBe(2)
    const out = await readForecast()
    expect(out.lines.map((l) => l.key)).toEqual(['loan:2'])
  })

  it('MPG metrics come from the latest date that has both residual and merchants', async () => {
    state.ratings = new Map([['m', { contact_id: 'm', business_id: 'mpg', temperature: 'hot', close_month: '2026-11-01', name: 'M' }]])
    state.metrics = {
      data: [
        { date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 5000 }, // newest date, no merchants
        { date: '2026-10-01', metric_key: 'rev_active_merchants', value: 10 },
        { date: '2026-10-01', metric_key: 'rev_monthly_residual', value: 2000 },
        { date: '2026-09-01', metric_key: 'rev_active_merchants', value: 40 },
        { date: '2026-09-01', metric_key: 'rev_monthly_residual', value: 4000 },
      ],
      error: null,
    }
    const out = await readForecast()
    expect(out.lines.find((l) => l.key === 'rating:m')).toMatchObject({ book: 'mpg', payout: 200, est: false })
  })

  it('MPG metrics are empty when no date has both', async () => {
    state.ratings = new Map([['m', { contact_id: 'm', business_id: 'mpg', temperature: 'hot', close_month: '2026-11-01', name: 'M' }]])
    state.metrics = {
      data: [
        { date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 5000 },
        { date: '2026-10-01', metric_key: 'rev_active_merchants', value: 10 },
      ],
      error: null,
    }
    const out = await readForecast()
    expect(out.lines.find((l) => l.key === 'rating:m')).toMatchObject({ book: 'mpg', payout: null })
  })
})
