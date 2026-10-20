import { describe, it, expect } from 'vitest'
import { cleanQuery, digitsOf, matchPages, MIN_QUERY } from './search'

describe('cleanQuery', () => {
  it('trims and strips characters that break a PostgREST filter', () => {
    expect(cleanQuery('  Jo, (Ramirez) "x" * 50% \ ')).toBe('Jo Ramirez x 50')
    expect(cleanQuery(null)).toBe('')
  })
  it('needs two characters to search', () => {
    expect(MIN_QUERY).toBe(2)
  })
})

describe('digitsOf', () => {
  it('keeps only digits', () => {
    expect(digitsOf('(713) 555-01')).toBe('71355501')
    expect(digitsOf('jo')).toBe('')
  })
})

describe('matchPages', () => {
  it('finds pages by name or keyword', () => {
    expect(matchPages('pipe').map((p) => p.to)).toEqual(['/bayway/pipeline', '/mpg/pipeline'])
    expect(matchPages('up next').map((p) => p.to)).toEqual(['/priority'])
    expect(matchPages('').length).toBe(0)
  })
})
