import { describe, it, expect } from 'vitest'
import { autoMap, normalizePhone, splitName, buildLeads, mappingError, listNameFrom, FIELDS } from './dialerImport'

describe('normalizePhone', () => {
  it('turns US numbers in any format into E.164', () => {
    expect(normalizePhone('8325551234')).toBe('+18325551234')
    expect(normalizePhone('(832) 555-1234')).toBe('+18325551234')
    expect(normalizePhone('832.555.1234')).toBe('+18325551234')
    expect(normalizePhone('+1 832 555 1234')).toBe('+18325551234')
    expect(normalizePhone('1-832-555-1234')).toBe('+18325551234')
  })
  it('drops an extension', () => {
    expect(normalizePhone('832-555-1234 ext 12')).toBe('+18325551234')
    expect(normalizePhone('832-555-1234 x12')).toBe('+18325551234')
  })
  it('reads numbers Excel turned into scientific notation', () => {
    expect(normalizePhone('8.325551234E+09')).toBe('+18325551234')
  })
  it('refuses numbers that cannot be dialed in the US', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone('555-1234')).toBeNull()
    expect(normalizePhone('132-555-1234')).toBeNull() // area code starts with 1
    expect(normalizePhone('832-155-1234')).toBeNull() // exchange starts with 1
    expect(normalizePhone('n/a')).toBeNull()
    expect(normalizePhone('83255512345')).toBeNull()
  })
  it('keeps a valid international number written with +', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
  })
})

describe('autoMap', () => {
  it('maps standard headers', () => {
    const m = autoMap(['First Name', 'Last Name', 'Company', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip'])
    expect(m).toMatchObject({
      first_name: 'First Name', last_name: 'Last Name', company: 'Company', phone: 'Phone',
      email: 'Email', address: 'Address', city: 'City', state: 'State', zip: 'Zip',
    })
    expect(m.full_name).toBe('')
  })
  it('maps nonstandard property-list headers', () => {
    const m = autoMap(['Owner Name', 'Business Name', 'Mobile', 'Property Address', 'Property City', 'ST', 'Postal Code', 'E-mail Address', 'Year Built'])
    expect(m).toMatchObject({
      full_name: 'Owner Name', company: 'Business Name', phone: 'Mobile', address: 'Property Address',
      city: 'Property City', state: 'ST', zip: 'Postal Code', email: 'E-mail Address',
    })
  })
  it('prefers an exact phone column over a looser match and uses each header once', () => {
    const m = autoMap(['Phone 2', 'Cell', 'Name'])
    expect(m.phone).toBe('Cell')
    expect(m.full_name).toBe('Name')
    const n = autoMap(['Owner Phone', 'Owner First Name'])
    expect(n.phone).toBe('Owner Phone')
    expect(n.first_name).toBe('Owner First Name')
    expect(n.full_name).toBe('')
  })
  it('does not map a business-name column as the person', () => {
    const m = autoMap(['DBA', 'Contact', 'Telephone'])
    expect(m.company).toBe('DBA')
    expect(m.full_name).toBe('Contact')
    expect(m.phone).toBe('Telephone')
  })
  it('leaves fields blank when nothing matches', () => {
    const m = autoMap(['Foo', 'Bar'])
    expect(Object.values(m).every((v) => v === '')).toBe(true)
    expect(Object.keys(m).sort()).toEqual(FIELDS.map((f) => f.key).sort())
  })
})

describe('splitName', () => {
  it('splits first and last', () => {
    expect(splitName('Jane Smith')).toEqual({ first: 'Jane', last: 'Smith' })
    expect(splitName('Mary Ann Smith')).toEqual({ first: 'Mary Ann', last: 'Smith' })
    expect(splitName('Smith, Jane')).toEqual({ first: 'Jane', last: 'Smith' })
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '' })
    expect(splitName('  ')).toEqual({ first: '', last: '' })
  })
})

describe('mappingError', () => {
  it('requires a phone column', () => {
    expect(mappingError({ phone: '' })).toMatch(/phone/i)
    expect(mappingError({ phone: 'Mobile' })).toBeNull()
  })
})

describe('listNameFrom', () => {
  it('uses the file name without its extension', () => {
    expect(listNameFrom('Houston restaurants.csv')).toBe('Houston restaurants')
    expect(listNameFrom('')).toBe('')
  })
})

describe('buildLeads', () => {
  const header = ['Owner Name', 'Business', 'Phone', 'Year Built']
  const rows = [
    { 'Owner Name': 'Jane Smith', Business: 'Acme Cafe', Phone: '832-555-0101', 'Year Built': '1999' },
    { 'Owner Name': 'Bob Jones', Business: 'Bob Tacos', Phone: 'none', 'Year Built': '' },
    { 'Owner Name': 'Ann Lee', Business: 'Lee Nails', Phone: '(832) 555-0101', 'Year Built': '' },
    { 'Owner Name': 'Do Not', Business: 'DNC Co', Phone: '832-555-0199', 'Year Built': '' },
    { 'Owner Name': 'Al Ready', Business: 'Ready Co', Phone: '832-555-0102', 'Year Built': '2010' },
  ]
  const mapping = autoMap(header)
  const out = buildLeads({ header, rows, mapping, dnc: new Set(['+18325550199']) })

  it('keeps CSV order and numbers the saved leads', () => {
    expect(out.leads.map((l) => l.company)).toEqual(['Acme Cafe', 'Bob Tacos', 'DNC Co', 'Ready Co'])
    expect(out.leads.map((l) => l.position)).toEqual([1, 2, 3, 4])
  })
  it('sets status from the checks', () => {
    expect(out.leads.map((l) => l.status)).toEqual(['queued', 'invalid_phone', 'dnc', 'queued'])
  })
  it('splits the mapped full name and keeps unmapped columns in extra', () => {
    expect(out.leads[0]).toMatchObject({ first_name: 'Jane', last_name: 'Smith', phone_raw: '832-555-0101', phone_e164: '+18325550101', extra: { 'Year Built': '1999' } })
    expect(out.leads[1].extra).toEqual({})
    expect(out.leads[1].phone_e164).toBeNull()
  })
  it('counts every bucket for the summary', () => {
    expect(out.summary).toEqual({ total: 5, ready: 2, dnc: 1, badPhone: 1, inFileDupes: 1, crm: 0 })
  })
  it('prefers mapped first/last over splitting the full name', () => {
    const r = buildLeads({
      header: ['First', 'Last', 'Name', 'Phone'],
      rows: [{ First: 'J', Last: 'S', Name: 'Jane Smith', Phone: '8325550101' }],
      mapping: { ...autoMap(['First', 'Last', 'Name', 'Phone']) },
      dnc: new Set(),
    })
    expect(r.leads[0]).toMatchObject({ first_name: 'J', last_name: 'S' })
    expect(r.leads[0].extra).toEqual({})
  })
  it('trims values and stores blanks as null', () => {
    const r = buildLeads({
      header: ['Phone', 'Email'],
      rows: [{ Phone: ' 8325550101 ', Email: '  ' }],
      mapping: autoMap(['Phone', 'Email']),
      dnc: new Set(),
    })
    expect(r.leads[0]).toMatchObject({ phone_raw: '8325550101', email: null, company: null })
  })
})

describe('buildLeads with the CRM check', () => {
  const header = ['Phone']
  const rows = [{ Phone: '8325550101' }, { Phone: '8325550102' }, { Phone: '8325550199' }]
  const mapping = autoMap(header)
  const crm = { '+18325550101': { crm: 'zoho', module: 'Leads', id: '11' }, '+18325550199': { crm: 'zoho', module: 'Leads', id: '12' } }
  it('holds numbers already in the CRM back by default and keeps the match', () => {
    const out = buildLeads({ header, rows, mapping, dnc: new Set(['+18325550199']), crm })
    expect(out.leads.map((l) => l.status)).toEqual(['crm_duplicate', 'queued', 'dnc'])
    expect(out.leads[0].crm_match).toEqual(crm['+18325550101'])
    expect(out.leads[1].crm_match).toBeNull()
    expect(out.summary).toMatchObject({ ready: 1, crm: 1, dnc: 1 })
  })
  it('dials them anyway when the list toggle is on', () => {
    const out = buildLeads({ header, rows, mapping, dnc: new Set(), crm, includeCrm: true })
    expect(out.leads.map((l) => l.status)).toEqual(['queued', 'queued', 'queued'])
    expect(out.summary).toMatchObject({ ready: 3, crm: 2 })
  })
})
