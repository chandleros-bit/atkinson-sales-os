import { describe, it, expect } from 'vitest'
import { pageSlice, PAGE_SIZE } from './paging'

const rows = Array.from({ length: 61 }, (_, i) => i + 1)

describe('pageSlice', () => {
  it('cuts 25 a page and says which rows show', () => {
    expect(PAGE_SIZE).toBe(25)
    const first = pageSlice(rows, 1)
    expect(first.rows).toHaveLength(25)
    expect(first).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 25 })
    const last = pageSlice(rows, 3)
    expect(last.rows).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61])
    expect(last).toMatchObject({ from: 51, to: 61 })
  })

  it('clamps a page past the end, and an empty list is one empty page', () => {
    expect(pageSlice(rows, 9).page).toBe(3)
    expect(pageSlice(rows, 0).page).toBe(1)
    expect(pageSlice([], 2)).toMatchObject({ rows: [], page: 1, pageCount: 1, from: 0, to: 0 })
  })
})
