import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('reads a header and rows as objects', () => {
    const { header, rows } = parseCsv('A,B\n1,2\n3,4\n')
    expect(header).toEqual(['A', 'B'])
    expect(rows).toEqual([{ A: '1', B: '2' }, { A: '3', B: '4' }])
  })

  it('keeps commas, doubled quotes and newlines inside quoted fields', () => {
    const { rows } = parseCsv('Title,Note\r\n"WestStar Title, LLC","He said ""hi""\nthen left"\r\n')
    expect(rows).toEqual([{ Title: 'WestStar Title, LLC', Note: 'He said "hi"\nthen left' }])
  })

  it('strips a BOM, trims header names and skips blank lines', () => {
    const { header, rows } = parseCsv('\uFEFF A , B\n\n1,2\n\n')
    expect(header).toEqual(['A', 'B'])
    expect(rows).toEqual([{ A: '1', B: '2' }])
  })

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsv('A,B,C\n1\n').rows).toEqual([{ A: '1', B: '', C: '' }])
  })

  it('returns no header for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] })
  })
})
