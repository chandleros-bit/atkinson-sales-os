import { describe, it, expect } from 'vitest'
import { fetchAll, fetchAllSettled } from './fetchAll'

// A fake data source. Each makeQuery() call returns a fresh builder whose
// .range() resolves the next scripted page and records the offsets it got.
function fakeSource(pages) {
  const ranges = []
  let calls = 0
  let next = 0
  const makeQuery = () => {
    calls++
    return {
      range(from, to) {
        ranges.push([from, to])
        return Promise.resolve(pages[next++] ?? { data: [], error: null })
      },
    }
  }
  return { makeQuery, ranges, calls: () => calls }
}

const rows = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i }))

describe('fetchAll', () => {
  it('returns a single short page as-is', async () => {
    const src = fakeSource([{ data: rows(37), error: null }])
    expect(await fetchAll(src.makeQuery)).toEqual(rows(37))
    expect(src.ranges).toEqual([[0, 999]])
  })

  it('asks for one more page after exactly 1,000 rows', async () => {
    const src = fakeSource([
      { data: rows(1000), error: null },
      { data: [], error: null },
    ])
    const out = await fetchAll(src.makeQuery)
    expect(out).toHaveLength(1000)
    expect(src.ranges).toEqual([[0, 999], [1000, 1999]])
  })

  it('pages 1,000 + 1,000 + 37 into 2,037 rows with the right offsets', async () => {
    const src = fakeSource([
      { data: rows(1000, 0), error: null },
      { data: rows(1000, 1000), error: null },
      { data: rows(37, 2000), error: null },
    ])
    const out = await fetchAll(src.makeQuery)
    expect(out).toHaveLength(2037)
    expect(out[0].id).toBe(0)
    expect(out[2036].id).toBe(2036)
    expect(src.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('builds a fresh query for every page', async () => {
    const src = fakeSource([
      { data: rows(1000), error: null },
      { data: rows(5), error: null },
    ])
    await fetchAll(src.makeQuery)
    expect(src.calls()).toBe(2)
  })

  it('throws on an error in page 2 instead of returning page 1', async () => {
    const src = fakeSource([
      { data: rows(1000), error: null },
      { data: null, error: { message: 'boom' } },
    ])
    await expect(fetchAll(src.makeQuery)).rejects.toThrow('boom')
  })

  it('treats null data as an empty last page', async () => {
    const src = fakeSource([{ data: null, error: null }])
    expect(await fetchAll(src.makeQuery)).toEqual([])
  })

  it('honors a custom pageSize', async () => {
    const src = fakeSource([
      { data: rows(2), error: null },
      { data: rows(1, 2), error: null },
    ])
    expect(await fetchAll(src.makeQuery, { pageSize: 2 })).toHaveLength(3)
    expect(src.ranges).toEqual([[0, 1], [2, 3]])
  })
})

describe('fetchAllSettled', () => {
  it('resolves { data, error: null } on success', async () => {
    const src = fakeSource([{ data: rows(3), error: null }])
    expect(await fetchAllSettled(src.makeQuery)).toEqual({ data: rows(3), error: null })
  })

  it('resolves { data: null, error } with a message on failure', async () => {
    const src = fakeSource([{ data: null, error: { message: 'nope' } }])
    const res = await fetchAllSettled(src.makeQuery)
    expect(res.data).toBeNull()
    expect(res.error.message).toBe('nope')
  })
})
