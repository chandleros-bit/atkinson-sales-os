import { describe, it, expect } from 'vitest'
import { pushFields, buildZohoDialerLead, buildFubDialerPerson, fubTagsForExisting, callHistoryNote, stageTargetFor } from './dialer-push.ts'
import { bayStageFromTags } from './bay-stages.ts'

const lead = { first_name: 'Jane', last_name: 'Smith', company: 'Acme Cafe', phone_e164: '+17135550101', email: null, address: '1 Main St', city: 'Houston', state: 'TX', zip: '77002' }

describe('pushFields', () => {
  it('takes the lead, with queue edits on top, blanks as null', () => {
    expect(pushFields(lead, { email: ' jane@acme.test ', company: '' })).toEqual({
      first_name: 'Jane', last_name: 'Smith', company: null, phone: '+17135550101', email: 'jane@acme.test',
      address: '1 Main St', city: 'Houston', state: 'TX', zip: '77002',
    })
  })
})

describe('buildZohoDialerLead', () => {
  it('is an Open lead from Chandler, tagged, with the list in the description', () => {
    const { data: [z] } = buildZohoDialerLead(pushFields(lead), { listName: 'Houston cafes' })
    expect(z).toEqual({
      First_Name: 'Jane', Last_Name: 'Smith', Company: 'Acme Cafe', Phone: '+17135550101',
      Street: '1 Main St', City: 'Houston', State: 'TX', Zip_Code: '77002',
      Lead_Status: 'Open', Lead_Source: 'Chandler', MPG_REP: 'Chandler',
      Description: 'Source: Sales OS Power Dialer – Houston cafes', Tag: [{ name: 'Power Dialer' }],
    })
  })
  it('uses the full name for Company when the CSV had none', () => {
    const { data: [z] } = buildZohoDialerLead(pushFields({ ...lead, company: null }))
    expect(z.Company).toBe('Jane Smith')
  })
  it('uses the company for Last_Name when there is no person', () => {
    const { data: [z] } = buildZohoDialerLead(pushFields({ phone_e164: '+17135550101', company: 'Acme Cafe' }))
    expect(z).toMatchObject({ Last_Name: 'Acme Cafe', Company: 'Acme Cafe' })
    expect(z.First_Name).toBeUndefined()
  })
  it('refuses a lead with neither', () => {
    expect(() => buildZohoDialerLead(pushFields({ phone_e164: '+17135550101' }))).toThrow(/company or a name/)
  })
})

describe('buildFubDialerPerson', () => {
  it('is a person with the dialer source and tags, assigned to Chandler', () => {
    const p = buildFubDialerPerson(pushFields(lead), { outcome: 'interested', temperature: 'cold', assignedUserId: '7' })
    expect(p).toEqual({
      firstName: 'Jane', lastName: 'Smith', source: 'CA Power Dialer', phones: [{ value: '+17135550101' }],
      tags: ['CA', 'CA Power Dialer', 'Cold', 'Working Estimate'],
      addresses: [{ street: '1 Main St', city: 'Houston', state: 'TX', code: '77002' }],
      assignedUserId: 7,
    })
    expect(bayStageFromTags(p.tags, 'Lead')).toBe('Contacted/Working')
  })
  it('lands Application sent in Application/Estimate Sent', () => {
    const p = buildFubDialerPerson(pushFields(lead), { outcome: 'application_sent', temperature: 'warm' })
    expect(p.tags).toEqual(['CA', 'CA Power Dialer', 'Warm', 'application sent'])
    expect(bayStageFromTags(p.tags, 'Lead')).toBe('Application/Estimate Sent')
    expect(stageTargetFor('callback_requested')).toBe('working')
  })
})

describe('fubTagsForExisting', () => {
  it('adds the dialer tags and moves an early lead forward', () => {
    const tags = fubTagsForExisting(['attempted', 'VIP'], 'Lead', { outcome: 'application_sent', temperature: 'warm' })
    expect(tags).toEqual(['VIP', 'CA', 'CA Power Dialer', 'Warm', 'application sent'])
  })
  it('never moves a lead back', () => {
    const tags = fubTagsForExisting(['application received'], 'Lead', { outcome: 'interested', temperature: 'cold' })
    expect(tags).toEqual(['application received', 'CA', 'CA Power Dialer', 'Cold'])
    expect(bayStageFromTags(tags, 'Lead')).toBe('Application Received')
  })
  it('leaves the stage of a person off the board alone', () => {
    expect(fubTagsForExisting(['Past Client'], 'Past Client', { outcome: 'interested', temperature: 'warm' })).toEqual(['Past Client', 'CA', 'CA Power Dialer', 'Warm'])
  })
  it('brings a parked lead back', () => {
    expect(fubTagsForExisting(['Nurture'], 'Lead', { outcome: 'interested' })).toEqual(['CA', 'CA Power Dialer', 'Working Estimate'])
  })
  it('does not duplicate tags already there', () => {
    expect(fubTagsForExisting(['ca', 'Working Estimate'], 'Lead', { outcome: 'interested' })).toEqual(['ca', 'Working Estimate', 'CA Power Dialer'])
  })
})

describe('callHistoryNote', () => {
  it('lists every logged call, oldest first, in Chicago time', () => {
    const n = callHistoryNote([
      { outcome: 'interested', notes: 'Wants rates', dialed_at: '2026-11-20T20:15:00Z' },
      { outcome: null, dialed_at: '2026-11-20T19:00:00Z' },
      { outcome: 'voicemail', notes: null, dialed_at: '2026-11-19T15:00:00Z' },
    ], { listName: 'Katy owners' })
    expect(n.title).toBe('Power Dialer call history')
    expect(n.body.split(String.fromCharCode(10))).toEqual([
      'Sales OS Power Dialer, list "Katy owners":',
      'Nov 19, 2026, 9:00 AM: Left voicemail',
      'Nov 20, 2026, 2:15 PM: Interested. Wants rates',
    ])
  })
  it('notes the callback time', () => {
    const n = callHistoryNote([{ outcome: 'callback_requested', dialed_at: '2026-11-20T20:15:00Z', callback_at: '2026-11-21T16:30:00Z' }])
    expect(n.body).toContain('Callback requested (callback Nov 21, 2026, 10:30 AM)')
  })
})
