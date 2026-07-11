import { describe, it, expect } from 'vitest'
import { getCredentials, mapStage, mapContact, mapDeal } from './zoho.ts'

const fakeGet = (obj) => (k) => obj[k]

describe('getCredentials', () => {
  it('throws listing all missing required secrets', () => {
    expect(() => getCredentials(fakeGet({}))).toThrow(
      /ZOHO_CLIENT_ID.*ZOHO_CLIENT_SECRET.*ZOHO_REFRESH_TOKEN/,
    )
  })
  it('returns config with default hosts when only required secrets are set', () => {
    const c = getCredentials(fakeGet({ ZOHO_CLIENT_ID: 'a', ZOHO_CLIENT_SECRET: 'b', ZOHO_REFRESH_TOKEN: 'c' }))
    expect(c).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      accountsHost: 'https://accounts.zoho.com',
      apiHost: 'https://www.zohoapis.com',
    })
  })
  it('uses provided data-center hosts', () => {
    const c = getCredentials(
      fakeGet({
        ZOHO_CLIENT_ID: 'a',
        ZOHO_CLIENT_SECRET: 'b',
        ZOHO_REFRESH_TOKEN: 'c',
        ZOHO_ACCOUNTS_HOST: 'https://accounts.zoho.eu',
        ZOHO_API_HOST: 'https://www.zohoapis.eu',
      }),
    )
    expect(c.accountsHost).toBe('https://accounts.zoho.eu')
    expect(c.apiHost).toBe('https://www.zohoapis.eu')
  })
})

describe('mapStage', () => {
  it('marks won/lost from the real Zoho forecast_type and keeps display_value as external_id', () => {
    // Real MPG Zoho forecast_type values are title-case with a space.
    expect(mapStage({ display_value: 'Closed Won', forecast_type: 'Closed Won' }, 3)).toEqual({
      business_id: 'mpg',
      name: 'Closed Won',
      sort_order: 3,
      is_won: true,
      is_lost: false,
      external_id: 'Closed Won',
    })
    expect(mapStage({ display_value: 'Closed-Lost to Competition', forecast_type: 'Closed Lost' }, 8).is_lost).toBe(true)
    const open = mapStage({ display_value: 'Qualification', forecast_type: 'Open' }, 1)
    expect(open.is_won).toBe(false)
    expect(open.is_lost).toBe(false)
  })
})

describe('mapContact', () => {
  it('maps a Zoho Lead with person_stage from Lead_Status', () => {
    const row = mapContact(
      {
        id: '101',
        Full_Name: 'Jane Doe',
        Company: 'Acme LLC',
        Email: 'j@acme.com',
        Phone: '555-1',
        Owner: { name: 'Chandler Atkinson' },
        Lead_Status: 'Attempted Contact',
        Last_Activity_Time: '2026-07-10T00:00:00Z',
        Modified_Time: '2026-07-11T00:00:00Z',
      },
      'Leads',
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: '101',
      name: 'Jane Doe',
      company: 'Acme LLC',
      email: 'j@acme.com',
      phone: '555-1',
      owner: 'Chandler Atkinson',
      person_stage: 'Attempted Contact',
      last_touch_at: '2026-07-10T00:00:00Z',
    })
  })
  it('maps a Zoho Contact: null person_stage, company from Account_Name, last_touch falls back to Modified_Time', () => {
    const row = mapContact(
      {
        id: '202',
        Full_Name: 'John Roe',
        Account_Name: { name: 'Roe Foods' },
        Email: 'john@roe.com',
        Owner: { name: 'Chandler Atkinson' },
        Modified_Time: '2026-07-09T00:00:00Z',
      },
      'Contacts',
    )
    expect(row.person_stage).toBe(null)
    expect(row.company).toBe('Roe Foods')
    expect(row.last_touch_at).toBe('2026-07-09T00:00:00Z')
  })
})

describe('mapDeal', () => {
  const contactIdByExternal = new Map([['101', 'uuid-contact']])
  const stageIndex = new Map([['Proposal', { id: 'uuid-stage', status: 'open' }]])
  it('resolves contact_id and stage_id/status, maps Amount and Software_Referral', () => {
    const row = mapDeal(
      {
        id: '303',
        Deal_Name: 'Acme merchant',
        Amount: 1250,
        Stage: 'Proposal',
        Closing_Date: '2026-08-01',
        Contact_Name: { id: '101' },
        Software_Referral: 'ISO Partner X',
      },
      contactIdByExternal,
      stageIndex,
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: '303',
      contact_id: 'uuid-contact',
      stage_id: 'uuid-stage',
      status: 'open',
      name: 'Acme merchant',
      value: 1250,
      referral_partner: 'ISO Partner X',
      expected_close: '2026-08-01',
    })
  })
  it('leaves contact_id/stage_id null and status open when unresolved', () => {
    const row = mapDeal(
      { id: '304', Stage: 'Unknown', Contact_Name: { id: '999' } },
      contactIdByExternal,
      stageIndex,
    )
    expect(row.contact_id).toBe(null)
    expect(row.stage_id).toBe(null)
    expect(row.status).toBe('open')
    expect(row.value).toBe(null)
  })
})
