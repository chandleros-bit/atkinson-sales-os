import { describe, it, expect } from 'vitest'
import { mapActivity, occurredAt, snippet, contactExternalId } from './zoho-activity.ts'

describe('occurredAt', () => {
  it('prefers the call start time over created', () => {
    expect(
      occurredAt({ Call_Start_Time: '2026-07-12T15:00:00Z', Created_Time: '2026-07-01T00:00:00Z' }, 'call'),
    ).toBe('2026-07-12T15:00:00Z')
  })
  it('prefers the event start over created', () => {
    expect(
      occurredAt({ Start_DateTime: '2026-07-12T15:00:00Z', Created_Time: '2026-07-01T00:00:00Z' }, 'appointment'),
    ).toBe('2026-07-12T15:00:00Z')
  })
  it('falls back to created then modified for a note', () => {
    expect(occurredAt({ Created_Time: 'c', Modified_Time: 'm' }, 'note')).toBe('c')
    expect(occurredAt({ Modified_Time: 'm' }, 'note')).toBe('m')
  })
  it('returns null when nothing matches', () => {
    expect(occurredAt({}, 'call')).toBe(null)
  })
})

describe('snippet', () => {
  it('uses call description, then subject, then a duration fallback', () => {
    expect(snippet({ Description: 'Discussed pricing' }, 'call')).toBe('Discussed pricing')
    expect(snippet({ Subject: 'Owner callback' }, 'call')).toBe('Owner callback')
    expect(snippet({ Call_Duration: '3:20' }, 'call')).toBe('Call · 3:20')
    expect(snippet({}, 'call')).toBe('Call')
  })
  it('uses the event title, then subject', () => {
    expect(snippet({ Event_Title: 'Merchant demo' }, 'appointment')).toBe('Merchant demo')
    expect(snippet({ Subject: 'Underwriting call' }, 'appointment')).toBe('Underwriting call')
    expect(snippet({}, 'appointment')).toBe('Meeting')
  })
  it('uses note content, then title', () => {
    expect(snippet({ Note_Content: 'Statement analyzed' }, 'note')).toBe('Statement analyzed')
    expect(snippet({ Note_Title: 'Follow up' }, 'note')).toBe('Follow up')
    expect(snippet({}, 'note')).toBe('Note')
  })
})

describe('contactExternalId', () => {
  it('reads Who_Id for calls and events', () => {
    expect(contactExternalId({ Who_Id: { id: '77' } }, 'call')).toBe('77')
    expect(contactExternalId({ Who_Id: { id: '88' } }, 'appointment')).toBe('88')
    expect(contactExternalId({}, 'call')).toBe(null)
  })
  it('reads a note Parent_Id only when the parent is a person module', () => {
    expect(contactExternalId({ Parent_Id: { id: '5' }, $se_module: 'Contacts' }, 'note')).toBe('5')
    expect(contactExternalId({ Parent_Id: { id: '5' }, $se_module: 'Leads' }, 'note')).toBe('5')
    expect(contactExternalId({ Parent_Id: { id: '5' }, $se_module: 'Deals' }, 'note')).toBe(null)
    expect(contactExternalId({ Parent_Id: { id: '5' } }, 'note')).toBe('5') // unknown module: try the id
    expect(contactExternalId({}, 'note')).toBe(null)
  })
})

describe('mapActivity', () => {
  const contactIdByExternal = new Map([['77', 'uuid-contact']])
  it('namespaces external_id by type and resolves contact_id from Who_Id', () => {
    const row = mapActivity(
      { id: 12, Who_Id: { id: '77' }, Call_Start_Time: '2026-07-12T14:00:00Z', Description: 'Pricing Q' },
      'call',
      contactIdByExternal,
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: 'call-12',
      type: 'call',
      contact_id: 'uuid-contact',
      occurred_at: '2026-07-12T14:00:00Z',
      notes: 'Pricing Q',
    })
    expect(row.raw.id).toBe(12)
  })
  it('leaves contact_id null when the Zoho id is unknown or missing', () => {
    expect(mapActivity({ id: 9, Who_Id: { id: '999' } }, 'call', contactIdByExternal).contact_id).toBe(null)
    expect(mapActivity({ id: 9 }, 'call', contactIdByExternal).contact_id).toBe(null)
  })
  it('resolves a note contact_id from its person parent', () => {
    const row = mapActivity(
      { id: 10, Parent_Id: { id: '77' }, $se_module: 'Contacts', Note_Content: 'Analyzed' },
      'note',
      contactIdByExternal,
    )
    expect(row.external_id).toBe('note-10')
    expect(row.contact_id).toBe('uuid-contact')
  })
})
