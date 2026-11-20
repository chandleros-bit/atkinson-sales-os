import { describe, it, expect } from 'vitest'
import { nestOr, zohoDupQueries, matchZohoRows, matchFubContacts, wantMap, tenDigits, COQL_MAX_CRITERIA } from './dialer-crm.ts'

const criteria = (q) => (q.match(/ like '/g) || []).length

describe('nestOr', () => {
  it('nests conditions in pairs, as COQL requires', () => {
    expect(nestOr(['a'])).toBe('a')
    expect(nestOr(['a', 'b'])).toBe('(a or b)')
    expect(nestOr(['a', 'b', 'c'])).toBe('((a or b) or c)')
  })
})

describe('zohoDupQueries', () => {
  const phones = Array.from({ length: 30 }, (_, i) => `+1713555${String(1000 + i)}`)
  const qs = zohoDupQueries(phones)
  it('stays under the 25-criteria cap in every query', () => {
    expect(qs.every((q) => criteria(q.query) <= COQL_MAX_CRITERIA)).toBe(true)
  })
  it('searches Phone and Mobile on Leads and Contacts, Phone on Accounts, by last 4 digits', () => {
    expect(qs.filter((q) => q.module === 'Leads')).toHaveLength(3) // 12 numbers per query
    expect(qs.filter((q) => q.module === 'Contacts')).toHaveLength(3)
    expect(qs.filter((q) => q.module === 'Accounts')).toHaveLength(2) // 25 per query
    expect(qs[0].query).toMatch(/^select id, Full_Name, Company, Phone, Mobile, Lead_Status, Owner\.first_name, Owner\.last_name from Leads where /)
    expect(qs[0].query).toContain("(Phone like '%1000' or Mobile like '%1000')")
    expect(qs[0].query).toMatch(/limit 2000$/)
  })
  it('asks once per shared tail', () => {
    const q = zohoDupQueries(['+17135551000', '+18325551000'])
    expect(q.map((x) => criteria(x.query))).toEqual([2, 2, 1])
  })
  it('asks nothing for no numbers', () => {
    expect(zohoDupQueries([])).toEqual([])
  })
})

describe('matching', () => {
  const want = wantMap(['+17135550101', '+17135550102', '+442079460958'])
  it('maps only US numbers by 10 digits', () => {
    expect([...want.keys()]).toEqual(['7135550101', '7135550102'])
    expect(tenDigits('+1 (713) 555-0101 x4')).toBe('7135550101')
  })
  it('matches Zoho rows on the full number in any format, first module wins', () => {
    const into = {}
    matchZohoRows('Leads', [
      { id: 11, Full_Name: 'Jane Smith', Company: 'Acme', Phone: '(713) 555-0101', Lead_Status: 'Open', 'Owner.first_name': 'Chandler', 'Owner.last_name': 'Atkinson' },
      { id: 12, Full_Name: 'Tail Only', Phone: '281-555-0102' }, // same last 4, different number
    ], want, into)
    matchZohoRows('Accounts', [{ id: 13, Account_Name: 'Acme Inc', Phone: '7135550101' }, { id: 14, Account_Name: 'Bob Co', Phone: '+1 713.555.0102' }], want, into)
    expect(into['+17135550101']).toEqual({ crm: 'zoho', module: 'Leads', id: '11', name: 'Jane Smith', owner: 'Chandler Atkinson', status: 'Open' })
    expect(into['+17135550102']).toMatchObject({ module: 'Accounts', id: '14', name: 'Bob Co', owner: null })
  })
  it('matches Mobile on Leads', () => {
    const into = matchZohoRows('Leads', [{ id: 21, Full_Name: 'M', Phone: null, Mobile: '713 555 0102' }], want, {})
    expect(into['+17135550102'].id).toBe('21')
  })
  it('matches synced FUB people on any of their numbers', () => {
    const into = matchFubContacts([
      { id: 'c1', external_id: '501', name: 'Ann', owner: 'Chandler', phone: '832-555-9999', phones: [{ value: '(713) 555-0101' }] },
      { id: 'c2', external_id: '502', name: 'Bo', owner: null, phone: '7135550102', phones: null },
    ], want)
    expect(into['+17135550101']).toEqual({ crm: 'fub', module: 'People', id: '501', name: 'Ann', owner: 'Chandler', contact_id: 'c1' })
    expect(into['+17135550102'].id).toBe('502')
  })
})
