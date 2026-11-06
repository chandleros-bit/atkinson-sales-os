import { describe, it, expect } from 'vitest'
import { phoneKey, cellText, sheetDate, yesNo, contactLabel, reachLabel, toTsv } from './mpgTracker'

describe('phoneKey', () => {
  it('keeps the 10 US digits', () => {
    expect(phoneKey('832-474-7707')).toBe('8324747707')
    expect(phoneKey('+1 (832) 474-7707')).toBe('8324747707')
  })
  it('is null for anything that is not a 10-digit US number', () => {
    expect(phoneKey('281767-898')).toBe(null)
    expect(phoneKey('')).toBe(null)
    expect(phoneKey(null)).toBe(null)
  })
})

describe('cellText', () => {
  it('turns null into an empty cell', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
  })
  it('replaces tabs and line breaks so a note stays in one cell', () => {
    expect(cellText('wants\tlower\nrates\r\nnow')).toBe('wants · lower · rates · now')
  })
  it('keeps Excel from reading text as a formula', () => {
    expect(cellText('+1 832 474 7707')).toBe(' +1 832 474 7707')
    expect(cellText('=SUM(A1)')).toBe(' =SUM(A1)')
    expect(cellText('-15% fee')).toBe(' -15% fee')
    expect(cellText('@owner')).toBe(' @owner')
  })
  it('trims ordinary text', () => {
    expect(cellText('  Feges BBQ ')).toBe('Feges BBQ')
  })
})

describe('sheetDate', () => {
  it('formats a day key as M/D/YYYY', () => {
    expect(sheetDate('2026-11-05')).toBe('11/5/2026')
  })
  it('formats a timestamp by its local day', () => {
    const d = new Date(2026, 9, 3, 23, 30) // Oct 3, 11:30 PM local
    expect(sheetDate(d.toISOString())).toBe('10/3/2026')
  })
  it('is empty for no date', () => {
    expect(sheetDate(null)).toBe('')
  })
})

describe('labels', () => {
  it('yesNo', () => {
    expect(yesNo(true)).toBe('Yes')
    expect(yesNo(false)).toBe('No')
    expect(yesNo(null)).toBe('No')
  })
  it('contactLabel joins name and role', () => {
    expect(contactLabel('Jimmy', 'Manager')).toBe('Jimmy / Manager')
    expect(contactLabel('Jimmy', '')).toBe('Jimmy')
    expect(contactLabel('', 'Owner')).toBe('Owner')
    expect(contactLabel(' ', null)).toBe(null)
  })
  it('reachLabel joins phone and email', () => {
    expect(reachLabel('832-474-7707', 'jimmy@njr.com')).toBe('832-474-7707 / jimmy@njr.com')
    expect(reachLabel('', 'jimmy@njr.com')).toBe('jimmy@njr.com')
    expect(reachLabel(null, null)).toBe(null)
  })
})

describe('toTsv', () => {
  it('joins cells with tabs and rows with line breaks, no header', () => {
    expect(toTsv([['a', 'b'], ['c', '']])).toBe('a\tb\nc\t')
  })
})
