// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = {
  upserts: [],
  invokes: [],
  rows: [],
  rangeCalls: 0,
  range: null, // optional override: (callNumber) => Promise<{ data, error }>
  upsertError: null,
  invoke: null, // optional override: (req) => Promise<reply>
  demo: false,
}
vi.mock('./supabase', () => ({
  get isDemoMode() {
    return state.demo
  },
  supabase: {
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        range: async () => {
          state.rangeCalls += 1
          return state.range ? state.range(state.rangeCalls) : { data: state.rows, error: null }
        },
        upsert: async (row) => {
          state.upserts.push(row)
          return { error: state.upsertError }
        },
      }
      return q
    },
  },
}))
vi.mock('./writeback', () => ({
  invokeCrmAction: async (req) => {
    state.invokes.push(req)
    if (state.invoke) return state.invoke(req)
    return { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }
  },
}))

const { toRatingMap, saveRating, refreshRatings, useLeadRatings, __resetRatingsForTest } = await import('./useLeadRatings')

// Read the shared store through the real hook.
async function readStore() {
  let seen
  const Probe = () => {
    seen = useLeadRatings()
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(React.createElement(Probe)))
  const out = seen
  await act(async () => root.unmount())
  return out
}

// Hold every fetch after the first, so a test can look at the optimistic local
// copy before the server's answer replaces it. Returns the release function.
function holdLaterFetches() {
  const waiting = []
  state.range = (n) => (n === 1 ? Promise.resolve({ data: state.rows, error: null }) : new Promise((resolve) => waiting.push(() => resolve({ data: state.rows, error: null }))))
  return () => waiting.forEach((fn) => fn())
}

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  state.upserts = []
  state.invokes = []
  state.rows = []
  state.rangeCalls = 0
  state.range = null
  state.upsertError = null
  state.invoke = null
  state.demo = false
  __resetRatingsForTest()
})

describe('toRatingMap', () => {
  it('keys by contact and lifts the contact score, tier and name', () => {
    const m = toRatingMap([{ contact_id: 'a', temperature: 'cold', contact: { name: 'Ann', score: 40, tier: 'warm' } }])
    expect(m.get('a')).toMatchObject({ temperature: 'cold', name: 'Ann', current_score: 40, current_tier: 'warm' })
  })
})

describe('saveRating', () => {
  it('upserts the rating and writes the FUB tag for Bayway', async () => {
    const res = await saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot', estAmount: 350000 })
    expect(res).toEqual({ ok: true })
    expect(state.upserts[0]).toMatchObject({ contact_id: 'c1', business_id: 'bay', temperature: 'hot', est_amount: 350000 })
    expect(state.invokes[0]).toMatchObject({ action: 'set_temperature', contact_id: 'c1', payload: { temperature: 'hot' } })
  })
  it('keeps MPG in the dashboard only', async () => {
    expect(await saveRating({ contactId: 'm1', businessId: 'mpg', temperature: 'warm' })).toEqual({ ok: true })
    expect(state.invokes).toEqual([])
  })

  it('leaves amount and close month out of the row when they are not passed', async () => {
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'warm' })
    const row = state.upserts[0]
    expect(row).not.toHaveProperty('est_amount')
    expect(row).not.toHaveProperty('close_month')
    expect(typeof row.rated_at).toBe('string')
  })
  it('clears the amount for 0 or null and the close month for null', async () => {
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'warm', estAmount: 0, closeMonth: null })
    expect(state.upserts[0]).toMatchObject({ est_amount: null, close_month: null })
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'warm', estAmount: null, closeMonth: '2026-12-01' })
    expect(state.upserts[1]).toMatchObject({ est_amount: null, close_month: '2026-12-01' })
  })
  it('sends a fresh rated_at on every save', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-03T10:00:00Z'))
      await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'warm' })
      vi.setSystemTime(new Date('2026-11-03T10:05:00Z'))
      await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'warm' })
    } finally {
      vi.useRealTimers()
    }
    expect(state.upserts[0].rated_at).not.toBe(state.upserts[1].rated_at)
  })

  it('keeps the saved amount in the local copy when a re-rate omits it', async () => {
    state.rows = [{ contact_id: 'c1', business_id: 'mpg', temperature: 'warm', est_amount: 250000, close_month: '2027-01-01', score_at_rating: 30, contact: { name: 'Ann', score: 30, tier: 'warm' } }]
    await refreshRatings()
    const release = holdLaterFetches()
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'hot' })
    const r = (await readStore()).get('c1')
    expect(r).toMatchObject({ temperature: 'hot', est_amount: 250000, close_month: '2027-01-01' })
    release()
    await refreshRatings()
  })

  it('re-snapshots score_at_rating locally so a same-temperature re-rate clears "Cold, but active"', async () => {
    state.rows = [{ contact_id: 'c1', business_id: 'mpg', temperature: 'cold', est_amount: null, close_month: null, score_at_rating: 5, contact: { name: 'Ann', score: 40, tier: 'warm' } }]
    await refreshRatings()
    const release = holdLaterFetches()
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'cold' })
    expect((await readStore()).get('c1')).toMatchObject({ temperature: 'cold', score_at_rating: 40 })
    release()
    await refreshRatings()
  })

  it('records a thrown refresh error and keeps the ratings it already had', async () => {
    state.rows = [{ contact_id: 'c1', business_id: 'mpg', temperature: 'warm', est_amount: null, close_month: null, score_at_rating: 30, contact: { name: 'Ann', score: 30, tier: 'warm' } }]
    await refreshRatings()
    state.range = () => {
      throw new Error('network down')
    }
    const after = await refreshRatings()
    expect(after.error).toBe('network down')
    expect(after.ratings.get('c1')).toMatchObject({ temperature: 'warm' })
    expect((await readStore()).get('c1')).toMatchObject({ temperature: 'warm' })
  })

  it('refreshes from the server after a save', async () => {
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'warm' })
    await refreshRatings()
    expect(state.rangeCalls).toBeGreaterThanOrEqual(1)
  })

  it('does not lose a save to a refresh that was already in flight', async () => {
    let releaseStale
    state.range = (n) =>
      n === 1
        ? new Promise((resolve) => { releaseStale = () => resolve({ data: [], error: null }) })
        : Promise.resolve({ data: [{ contact_id: 'c1', business_id: 'mpg', temperature: 'hot', est_amount: 111, contact: { name: 'Ann', score: 9, tier: 'cold' } }], error: null })
    const pending = refreshRatings()
    await tick()
    expect(state.rangeCalls).toBe(1)
    await saveRating({ contactId: 'c1', businessId: 'mpg', temperature: 'hot' })
    releaseStale()
    const store = await pending
    expect(state.rangeCalls).toBe(2)
    // The second fetch's data is what landed, and it still has the rating.
    expect(store.ratings.get('c1')).toMatchObject({ temperature: 'hot', est_amount: 111, name: 'Ann' })
  })

  it('writes two quick re-rates of one contact to FUB in call order', async () => {
    const log = []
    state.invoke = async (req) => {
      const t = req.payload.temperature
      log.push(`start ${t}`)
      if (t === 'hot') await new Promise((r) => setTimeout(r, 20))
      log.push(`end ${t}`)
      return { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }
    }
    const a = saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot' })
    const b = saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'cold' })
    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }])
    expect(log).toEqual(['start hot', 'end hot', 'start cold', 'end cold'])
    expect(state.upserts.map((u) => u.temperature)).toEqual(['hot', 'cold'])
  })

  it('does not serialize different contacts behind each other', async () => {
    let release
    state.invoke = (req) =>
      req.contact_id === 'slow'
        ? new Promise((resolve) => { release = () => resolve({ status: 'ok' }) })
        : Promise.resolve({ status: 'ok' })
    const slow = saveRating({ contactId: 'slow', businessId: 'bay', temperature: 'hot' })
    expect(await saveRating({ contactId: 'fast', businessId: 'bay', temperature: 'hot' })).toEqual({ ok: true })
    release()
    await slow
  })

  it('reports a FUB tag failure as tagError, rating still saved', async () => {
    state.invoke = async () => ({ status: 'error', error: 'FUB PUT /people/1 -> 500: down' })
    const res = await saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot' })
    expect(res).toEqual({ ok: true, tagError: 'FUB PUT /people/1 -> 500: down' })
    expect(state.upserts).toHaveLength(1)
  })
  it('falls back to the failed step\'s error for tagError', async () => {
    state.invoke = async () => ({ status: 'error', results: [{ step: 'set_temperature', ok: false, error: 'step failed' }] })
    expect(await saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot' })).toEqual({ ok: true, tagError: 'step failed' })
  })

  it('returns ok:false and skips FUB when the rating upsert fails', async () => {
    state.upsertError = { message: 'permission denied' }
    const res = await saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot' })
    expect(res).toEqual({ ok: false, error: 'permission denied' })
    expect(state.invokes).toEqual([])
    expect(state.rangeCalls).toBe(0)
  })

  it('refuses in demo mode', async () => {
    state.demo = true
    expect(await saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot' })).toEqual({ ok: false, error: 'Demo mode' })
    expect(state.upserts).toEqual([])
    expect(state.invokes).toEqual([])
  })
})

describe('focus refresh', () => {
  it('does nothing while no page is using the ratings', async () => {
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(state.rangeCalls).toBe(0)
  })
})
