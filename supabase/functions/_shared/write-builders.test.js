import { describe, it, expect } from 'vitest'
import { buildFubCall, buildFubNote, buildFubTask, buildFubTaskUpdate, buildFubLeadEvent, FUB_OUTCOMES } from './fub-write.ts'
import {
  buildZohoCall, buildZohoNote, buildZohoTask, buildZohoTaskUpdate,
  zohoDuration, zohoDateTime, zohoCallResult, zohoCreatedId, buildZohoLead,
} from './zoho-write.ts'

describe('buildFubCall', () => {
  it('builds an outbound call with duration in seconds', () => {
    expect(buildFubCall({ personId: '4821', phone: '(713) 555-0142', outcome: 'Left Message', note: 'call back', durationMin: 1.5 }))
      .toEqual({ personId: 4821, phone: '(713) 555-0142', isIncoming: false, outcome: 'Left Message', note: 'call back', duration: 90 })
  })
  it('omits an empty note and a zero duration', () => {
    expect(buildFubCall({ personId: 1, phone: '5', outcome: 'Busy', durationMin: 0 }))
      .toEqual({ personId: 1, phone: '5', isIncoming: false, outcome: 'Busy' })
  })
  it('refuses a missing phone, an unknown outcome and a bad person id', () => {
    expect(() => buildFubCall({ personId: 1, phone: '', outcome: 'Busy' })).toThrow('No phone on file in FUB')
    expect(() => buildFubCall({ personId: 1, phone: '5', outcome: 'Connected' })).toThrow(/outcome/)
    expect(() => buildFubCall({ personId: 'abc', phone: '5', outcome: 'Busy' })).toThrow(/person id/)
  })
  it('accepts all six FUB outcomes', () => {
    for (const o of FUB_OUTCOMES) expect(buildFubCall({ personId: 1, phone: '5', outcome: o }).outcome).toBe(o)
  })
})

describe('buildFubNote', () => {
  it('defaults the subject', () => {
    expect(buildFubNote({ personId: '9', body: 'Asked for W-2s' }))
      .toEqual({ personId: 9, subject: 'Note from Sales OS', body: 'Asked for W-2s' })
    expect(buildFubNote({ personId: '9', subject: 'Docs', body: 'x' }).subject).toBe('Docs')
  })
  it('refuses an empty body', () => {
    expect(() => buildFubNote({ personId: 9, body: '' })).toThrow()
  })
})

describe('buildFubTask', () => {
  it('always assigns and defaults the type to Follow Up', () => {
    expect(buildFubTask({ personId: '9', assignedUserId: '12', title: 'Follow up: Jo', dueDate: '2026-10-19' }))
      .toEqual({ personId: 9, assignedUserId: 12, name: 'Follow up: Jo', type: 'Follow Up', dueDate: '2026-10-19' })
  })
  it('refuses a missing assignee, an unknown type and a bad date', () => {
    expect(() => buildFubTask({ personId: 9, dueDate: '2026-10-19' })).toThrow(/FUB_USER_ID/)
    expect(() => buildFubTask({ personId: 9, assignedUserId: 1, type: 'Lunch', dueDate: '2026-10-19' })).toThrow(/type/)
    expect(() => buildFubTask({ personId: 9, assignedUserId: 1, dueDate: '10/19/2026' })).toThrow(/YYYY-MM-DD/)
  })
})

describe('buildFubTaskUpdate', () => {
  it('completes or moves', () => {
    expect(buildFubTaskUpdate({ complete: true })).toEqual({ isCompleted: true })
    expect(buildFubTaskUpdate({ dueDate: '2026-10-21' })).toEqual({ dueDate: '2026-10-21' })
    expect(() => buildFubTaskUpdate({})).toThrow()
  })
})

describe('zohoDuration / zohoDateTime', () => {
  it('formats minutes as mm:ss', () => {
    expect(zohoDuration(5)).toBe('05:00')
    expect(zohoDuration(1.5)).toBe('01:30')
    expect(zohoDuration(75)).toBe('75:00')
  })
  it('writes an explicit +00:00 offset', () => {
    expect(zohoDateTime(new Date('2026-10-18T15:04:05.678Z'))).toBe('2026-10-18T15:04:05+00:00')
  })
})

describe('buildZohoCall', () => {
  const now = new Date('2026-10-18T15:00:00Z')
  it('starts the call duration + 1 minute ago and links the lead', () => {
    expect(buildZohoCall({ leadId: 555, outcome: 'Interested', note: 'wants a quote', durationMin: 5, now })).toEqual({
      data: [{
        Subject: 'Call: Interested',
        Call_Type: 'Outbound',
        Call_Start_Time: '2026-10-18T14:54:00+00:00',
        Call_Duration: '05:00',
        Description: 'Interested: wants a quote',
        What_Id: '555',
        $se_module: 'Leads',
      }],
    })
  })
  it('adds Call_Result only when the org has the picklist', () => {
    expect(buildZohoCall({ leadId: 1, outcome: 'Bad Number', durationMin: 1, now, callResult: true }).data[0].Call_Result)
      .toBe('Invalid number')
    expect('Call_Result' in buildZohoCall({ leadId: 1, outcome: 'Busy', durationMin: 1, now }).data[0]).toBe(false)
  })
  it('maps every outcome and refuses an unknown one', () => {
    expect(zohoCallResult('No Answer')).toBe('No response/Busy')
    expect(() => buildZohoCall({ leadId: 1, outcome: 'Connected', now })).toThrow(/outcome/)
  })
})

describe('Zoho note / task bodies', () => {
  it('wraps a note', () => {
    expect(buildZohoNote({ body: 'Sent rates' }))
      .toEqual({ data: [{ Note_Title: 'Note from Sales OS', Note_Content: 'Sent rates' }] })
  })
  it('creates a task on the lead', () => {
    expect(buildZohoTask({ leadId: '555', title: 'Follow up: Ana', dueDate: '2026-10-20' })).toEqual({
      data: [{ Subject: 'Follow up: Ana', Due_Date: '2026-10-20', Status: 'Not Started', What_Id: '555', $se_module: 'Leads' }],
    })
  })
  it('completes or moves a task by id', () => {
    expect(buildZohoTaskUpdate({ id: 77, complete: true })).toEqual({ data: [{ id: '77', Status: 'Completed' }] })
    expect(buildZohoTaskUpdate({ id: 77, dueDate: '2026-10-22' })).toEqual({ data: [{ id: '77', Due_Date: '2026-10-22' }] })
  })
  it('reads the created id', () => {
    expect(zohoCreatedId({ data: [{ code: 'SUCCESS', status: 'success', details: { id: '9001' } }] })).toBe('9001')
    expect(() => zohoCreatedId({ data: [] })).toThrow()
  })
})

describe('buildFubLeadEvent', () => {
  it('sends a Registration event from Atkinson Sales OS, trimmed', () => {
    expect(buildFubLeadEvent({ firstName: ' Sam ', lastName: 'Lee ', phone: ' (713) 555-0100', email: ' sam@example.com ' })).toEqual({
      source: 'Atkinson Sales OS',
      system: 'Atkinson Sales OS',
      type: 'Registration',
      person: {
        firstName: 'Sam',
        lastName: 'Lee',
        phones: [{ value: '(713) 555-0100' }],
        emails: [{ value: 'sam@example.com' }],
      },
    })
  })
  it('leaves out an empty phone or email', () => {
    expect(buildFubLeadEvent({ firstName: 'Sam', lastName: '', phone: '', email: 'sam@example.com' }).person)
      .toEqual({ firstName: 'Sam', emails: [{ value: 'sam@example.com' }] })
  })
})

describe('buildZohoLead', () => {
  it('creates a Not Contacted lead, trimmed, leaving out blanks', () => {
    expect(buildZohoLead({ firstName: ' Ana ', lastName: 'Ruiz', company: ' Ruiz Deli ', phone: '', email: 'ana@example.com' })).toEqual({
      data: [{ First_Name: 'Ana', Last_Name: 'Ruiz', Company: 'Ruiz Deli', Email: 'ana@example.com', Lead_Status: 'Not Contacted' }],
    })
  })
})
