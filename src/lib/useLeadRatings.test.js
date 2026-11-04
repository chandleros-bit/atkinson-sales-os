import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { upserts: [], invokes: [], rows: [] }
vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        range: async () => ({ data: state.rows, error: null }),
        upsert: async (row) => {
          state.upserts.push(row)
          return { error: null }
        },
      }
      return q
    },
  },
}))
vi.mock('./writeback', () => ({
  invokeCrmAction: async (req) => {
    state.invokes.push(req)
    return { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }
  },
}))

const { toRatingMap, saveRating } = await import('./useLeadRatings')

beforeEach(() => {
  state.upserts = []
  state.invokes = []
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
    expect(state.upserts[0]).toMatchObject({ contact_id: 'c1', business_id: 'bay', temperature: 'hot', est_amount: 350000, close_month: null })
    expect(state.invokes[0]).toMatchObject({ action: 'set_temperature', contact_id: 'c1', payload: { temperature: 'hot' } })
  })
  it('keeps MPG in the dashboard only', async () => {
    expect(await saveRating({ contactId: 'm1', businessId: 'mpg', temperature: 'warm' })).toEqual({ ok: true })
    expect(state.invokes).toEqual([])
  })
})
