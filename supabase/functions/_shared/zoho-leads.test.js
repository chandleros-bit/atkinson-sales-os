import { describe, it, expect } from 'vitest'
import { coqlString, findLeadsQuery, matchLeads, buildPromotedLead, splitName } from './zoho-leads.ts'

describe('coqlString', () => {
  it('quotes and doubles single quotes', () => {
    expect(coqlString("Boeger's Stores")).toBe("'Boeger''s Stores'")
  })
})

describe('findLeadsQuery', () => {
  it('searches phone tails and the exact company', () => {
    expect(findLeadsQuery({ phoneKey: '8324747707', company: "NJR's Salons" })).toBe(
      "select id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status from Leads where ((Phone like '%7707' or Mobile like '%7707') or Company = 'NJR''s Salons') limit 50",
    )
  })
  it('company only when there is no phone', () => {
    expect(findLeadsQuery({ phoneKey: null, company: 'Feges BBQ' })).toBe(
      "select id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status from Leads where (Company = 'Feges BBQ') limit 50",
    )
  })
  it('null when there is nothing to search by', () => {
    expect(findLeadsQuery({ phoneKey: null, company: '  ' })).toBe(null)
  })
})

describe('findLeadsQuery odd input', () => {
  const head = 'select id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status from Leads where '
  it('skips a phone that is not exactly 10 digits', () => {
    expect(findLeadsQuery({ phoneKey: '(832) 474', company: 'Foo' })).toBe(`${head}(Company = 'Foo') limit 50`)
    expect(findLeadsQuery({ phoneKey: '77', company: '' })).toBe(null)
  })
  it('normalises an 11-digit key with a leading 1', () => {
    expect(findLeadsQuery({ phoneKey: '18324747707', company: '' })).toBe(`${head}((Phone like '%7707' or Mobile like '%7707')) limit 50`)
  })
  it('drops a company with a backslash, keeping the phone', () => {
    expect(findLeadsQuery({ phoneKey: '8324747707', company: 'Foo\\' })).toBe(`${head}((Phone like '%7707' or Mobile like '%7707')) limit 50`)
    expect(findLeadsQuery({ phoneKey: null, company: 'Foo\\' })).toBe(null)
  })
  it('collapses whitespace in the company', () => {
    expect(findLeadsQuery({ phoneKey: null, company: 'Foo\t Bar\nBaz' })).toBe(`${head}(Company = 'Foo Bar Baz') limit 50`)
  })
  it('skips a company over 100 characters', () => {
    expect(findLeadsQuery({ phoneKey: null, company: 'a'.repeat(101) })).toBe(null)
    expect(findLeadsQuery({ phoneKey: null, company: 'a'.repeat(100) })).not.toBe(null)
  })
})

describe('matchLeads', () => {
  it('matches a stored phone with an extension, in Phone or Mobile', () => {
    expect(matchLeads([{ id: '1', Phone: '832-474-7707 x2' }, { id: '2', Mobile: '1 (832) 474-7707 ext 12' }], { phoneKey: '8324747707', company: '' }).map((r) => r.id)).toEqual(['1', '2'])
  })
  it('matches nothing without a phone or company', () => {
    expect(matchLeads([{ id: '1', Company: '' }], { phoneKey: null, company: '' })).toEqual([])
  })
  const recs = [
    { id: '1', Company: 'NJR Salons', Phone: '432-296-2997', Lead_Status: 'Pending' },
    { id: '2', Company: 'Other', Phone: '(832) 474-7707', Lead_Status: 'Initial lead' },
    { id: '3', Company: 'Third', Phone: '555-111-7707', Mobile: null, Lead_Status: 'Open' },
  ]
  it('keeps a full 10-digit phone match and a case/space-insensitive company match', () => {
    expect(matchLeads(recs, { phoneKey: '8324747707', company: ' njr salons ' }).map((r) => r.id)).toEqual(['1', '2'])
  })
  it('drops a lead that only shares the last 4 digits', () => {
    expect(matchLeads(recs, { phoneKey: '8324747707', company: 'Nope' }).map((r) => r.id)).toEqual(['2'])
  })
  it('maps candidates for the picker', () => {
    const [c] = matchLeads([{ id: '9', Company: 'A', First_Name: 'Jo', Last_Name: 'Lee', Phone: '8324747707', Lead_Status: 'Open' }], { phoneKey: '8324747707', company: 'x' })
    expect(c).toEqual({ id: '9', company: 'A', name: 'Jo Lee', phone: '8324747707', status: 'Open' })
  })
})

describe('splitName', () => {
  it('splits first and last', () => {
    expect(splitName('Jimmy Ray Smith')).toEqual({ firstName: 'Jimmy Ray', lastName: 'Smith' })
    expect(splitName('Jimmy')).toEqual({ firstName: '', lastName: 'Jimmy' })
    expect(splitName('  ')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('buildPromotedLead', () => {
  it('caps Last_Name at 80 and Company at 100 characters', () => {
    const [lead] = buildPromotedLead({ business: 'b'.repeat(150), contactName: 'Jo ' + 'x'.repeat(120) }).data
    expect(lead.Company).toHaveLength(100)
    expect(lead.Last_Name).toHaveLength(80)
    expect(buildPromotedLead({ business: 'c'.repeat(150) }).data[0].Last_Name).toHaveLength(80)
  })
  it('builds an Open lead credited to Chandler', () => {
    expect(buildPromotedLead({
      business: 'Feges BBQ', contactName: 'Patrick Feges', role: 'Owner', phone: '713-555-0101', email: '', address: null,
    })).toEqual({ data: [{
      First_Name: 'Patrick', Last_Name: 'Feges', Company: 'Feges BBQ', Phone: '713-555-0101',
      Designation: 'Owner', Lead_Status: 'Open', Lead_Source: 'Chandler', MPG_REP: 'Chandler',
    }] })
  })
  it('uses the business as Last_Name when there is no contact name', () => {
    const lead = buildPromotedLead({ business: 'Casa Pickle' }).data[0]
    expect(lead.Last_Name).toBe('Casa Pickle')
    expect(lead).not.toHaveProperty('First_Name')
  })
  it('puts the address in Description', () => {
    expect(buildPromotedLead({ business: 'X', address: '1 Main St' }).data[0].Description).toBe('Address: 1 Main St')
  })
  it('needs a business', () => {
    expect(() => buildPromotedLead({ business: ' ' })).toThrow('A Zoho lead needs a company')
  })
})
