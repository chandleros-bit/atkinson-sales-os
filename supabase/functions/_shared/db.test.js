import { describe, it, expect } from 'vitest'
import { fetchAll } from './db.ts'

// A fake PostgREST query builder. makeQuery() must return a fresh object each
// call (fetchAll calls it once per page), so this is a factory. `pages` is the
// full row set; the builder serves the slice for whatever range is requested,
// capped at PostgREST's real behaviour of returning at most (to - from + 1).
function fakeSource(pages, { error = null } = {}) {
  let rangeCalls = 0
  const factory = () => ({
    range(from, to) {
      rangeCalls++
      if (error) return Promise.resolve({ data: null, error })
      return Promise.resolve({ data: pages.slice(from, to + 1), error: null })
    },
  })
  factory.rangeCalls = () => rangeCalls
  return factory
}

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }))

describe('fetchAll', () => {
  it('returns everything in a single page when under the cap', async () => {
    const src = fakeSource(rows(42))
    const out = await fetchAll(src)
    expect(out).toHaveLength(42)
    // A short page means no reason to ask for a second one.
    expect(src.rangeCalls()).toBe(1)
  })

  it('pages past the 1000-row cap and concatenates in order', async () => {
    const src = fakeSource(rows(2300))
    const out = await fetchAll(src)
    expect(out).toHaveLength(2300)
    expect(out[0].id).toBe(0)
    expect(out[2299].id).toBe(2299)
    // 1000 + 1000 + 300: three fetches, the last short one ends the loop.
    expect(src.rangeCalls()).toBe(3)
  })

  it('makes a second request at exactly 1000 to learn the set ends there', async () => {
    // A full page is indistinguishable from a truncated one, so fetchAll must
    // ask again; the empty follow-up page is what proves the set is complete.
    const src = fakeSource(rows(1000))
    const out = await fetchAll(src)
    expect(out).toHaveLength(1000)
    expect(src.rangeCalls()).toBe(2)
  })

  it('returns an empty array for an empty table', async () => {
    const src = fakeSource(rows(0))
    expect(await fetchAll(src)).toEqual([])
  })

  it('throws on a query error rather than returning a partial result', async () => {
    const src = fakeSource(rows(50), { error: { message: 'permission denied' } })
    await expect(fetchAll(src)).rejects.toThrow('permission denied')
  })
})
