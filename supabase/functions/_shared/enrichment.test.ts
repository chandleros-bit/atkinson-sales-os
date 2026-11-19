import { describe, it, expect } from 'vitest'
import { parseCsv, mapRow, mergeProperty, inferConfidence, splitAddress } from './enrichment.ts'

const HCAD_CSV = [
  'fub_id,household_id,first_name,last_name,last_known_street,last_known_city,last_known_state,last_known_zip,data_note,property_address (return),county (return),recording_date (return),sale_price (return),original_loan_amount (return),lender (return),owner_names_as_recorded (return),hcad_account,market_value,homestead,confidence,match_note',
  '101,H0001,Daniel,Arana,1 Old St,Houston,TX,77001,,"12211 HURST CT, CYPRESS, TX 77429",Harris,2022-04-18,,,,ARANA DANIEL,1234567890123,385000,Y,high,',
  '102,H0002,Olivia,Baker,2 Old St,Houston,TX,77002,,"3784 JARDIN ST, HOUSTON, TX 77005",Harris,2025-05-27,,,,BAKER BRYAN D & OLIVIA C,2,900000,N,medium,2 candidate parcels; newest shown',
  '103,H0003,Ann,Lee,3 Old St,Houston,TX,77003,,,,,,,,,,,,,no Harris match',
].join('\n')

describe('parseCsv', () => {
  it('handles quoted commas and keeps every column', () => {
    const rows = parseCsv(HCAD_CSV)
    expect(rows).toHaveLength(3)
    expect(rows[0]['property_address (return)']).toBe('12211 HURST CT, CYPRESS, TX 77429')
    expect(rows[1].match_note).toBe('2 candidate parcels; newest shown')
  })
  it('handles escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"say ""hi""",2\r\n')).toEqual([{ a: 'say "hi"', b: '2' }])
  })
})

describe('mapRow', () => {
  const rows = parseCsv(HCAD_CSV)
  it('maps a county match into property facts', () => {
    const m = mapRow(rows[0], { marketValueYear: 2026 })!
    expect(m.confidence).toBe('high')
    expect(m.property).toMatchObject({
      address: '12211 HURST CT', city: 'CYPRESS', state: 'TX', zip: '77429', county: 'Harris',
      recording_date: '2022-04-18', market_value: 385000, market_value_year: 2026, homestead: true,
      orig_loan_amount: null, kept_prior_home: false,
    })
  })
  it('keeps medium matches for review and blank rows as low', () => {
    expect(mapRow(rows[1])!.confidence).toBe('medium')
    expect(mapRow(rows[2])).toMatchObject({ confidence: 'low', property: null })
  })
  it('reads a title rep row with loan amount and lender, and infers confidence', () => {
    const r = {
      fub_id: '9', first_name: 'Daniel', last_name: 'Arana',
      'property_address (return)': '12211 Hurst Ct, Cypress, TX 77429',
      'recording_date (return)': '4/18/2022', 'original_loan_amount (return)': '$310,500',
      'lender (return)': 'UWM', 'owner_names_as_recorded (return)': 'Daniel Arana and Maria Arana',
    }
    const m = mapRow(r)!
    expect(m.confidence).toBe('high')
    expect(m.property).toMatchObject({ recording_date: '2022-04-18', orig_loan_amount: 310500, lender: 'UWM' })
    expect(inferConfidence({ ...r, 'owner_names_as_recorded (return)': 'Maria Arana' })).toBe('medium')
    expect(inferConfidence({ ...r, 'owner_names_as_recorded (return)': 'John Smith' })).toBe('low')
  })
})

describe('mergeProperty', () => {
  const county = mapRow(parseCsv(HCAD_CSV)[0], { marketValueYear: 2026 })!.property!
  it('never overwrites a manual row', () => {
    expect(mergeProperty({ is_manual: true, address: 'x' }, county, 'hcad', 'high')).toBeNull()
  })
  it('lets the title rep file fill in what the county file lacks, without erasing values', () => {
    const stored = mergeProperty(null, county, 'hcad', 'high')!
    const rep = { ...county, market_value: null, market_value_year: null, homestead: null,
      orig_loan_amount: 310500, lender: 'UWM', address: '12211 Hurst Ct' }
    const merged = mergeProperty(stored as never, rep, 'title_rep', 'high')!
    expect(merged).toMatchObject({ market_value: 385000, homestead: true, orig_loan_amount: 310500, lender: 'UWM', source: 'hcad' })
  })
  it('replaces the row when the match is a different property', () => {
    const stored = mergeProperty(null, county, 'hcad', 'high')!
    const other = { ...county, address: '99 NEW RD', market_value: null }
    const merged = mergeProperty(stored as never, other, 'title_rep', 'high')!
    expect(merged.address).toBe('99 NEW RD')
    expect(merged.market_value).toBeNull()
    expect(merged.source).toBe('title_rep')
  })
})

describe('splitAddress', () => {
  it('falls back to the whole string', () => {
    expect(splitAddress('Lot 4 Main')).toEqual({ address: 'Lot 4 Main', city: null, state: null, zip: null })
  })
})
