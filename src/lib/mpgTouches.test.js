import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
const state = { touchError: null }
vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: (table) => {
      const q = {}
      q.insert = (row) => { calls.push({ table, op: 'insert', row }); return q }
      q.select = () => q
      q.single = async () => (table === 'mpg_touches' && state.touchError
        ? { data: null, error: state.touchError }
        : { data: { id: 't1' }, error: null })
      q.update = (patch) => { calls.push({ table, op: 'update', patch }); return q }
      q.eq = (c, v) => { calls.push({ table, op: 'eq', c, v }); return q }
      q.neq = (c, v) => { calls.push({ table, op: 'neq', c, v }); return q }
      q.then = (resolve) => resolve({ data: null, error: { message: 'ignored' } })
      return q
    },
  },
}))

const { saveVisit } = await import('./mpgTouches')

beforeEach(() => { calls.length = 0; state.touchError = null })

describe('saveVisit zoho_wanted on an existing prospect', () => {
  it('sets it after the touch insert, skipping promoted prospects', async () => {
    const res = await saveVisit({ prospect: null, touch: { prospect_id: 'p1' }, zohoWanted: true })
    expect(res.error).toBeNull()
    const ops = calls.map((c) => `${c.table}:${c.op}`)
    expect(ops.indexOf('mpg_touches:insert')).toBeLessThan(ops.indexOf('mpg_prospects:update'))
    expect(calls).toContainEqual({ table: 'mpg_prospects', op: 'neq', c: 'status', v: 'promoted' })
  })

  it('clears it when the visit is saved with the toggle off', async () => {
    const res = await saveVisit({ prospect: null, touch: { prospect_id: 'p1' }, zohoWanted: false })
    expect(res.error).toBeNull()
    expect(calls).toContainEqual({ table: 'mpg_prospects', op: 'update', patch: { zoho_wanted: false } })
    expect(calls).toContainEqual({ table: 'mpg_prospects', op: 'eq', c: 'id', v: 'p1' })
  })

  it('does not clear it when the touch insert fails', async () => {
    state.touchError = { message: 'nope' }
    await saveVisit({ prospect: null, touch: { prospect_id: 'p1' }, zohoWanted: false })
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })

  it('does not set it when the touch insert fails', async () => {
    state.touchError = { message: 'nope' }
    await saveVisit({ prospect: null, touch: { prospect_id: 'p1' }, zohoWanted: true })
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })
})
