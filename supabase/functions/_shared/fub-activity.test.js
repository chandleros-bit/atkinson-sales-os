import { describe, it, expect } from 'vitest'
import { mapActivity, occurredAt, snippet } from './fub-activity.ts'

describe('occurredAt', () => {
  it('prefers appointment date over created', () => {
    expect(
      occurredAt({ date: '2026-07-12T15:00:00Z', created: '2026-07-01T00:00:00Z' }, 'appointment'),
    ).toBe('2026-07-12T15:00:00Z')
  })
  it('falls back to created for a call', () => {
    expect(occurredAt({ created: '2026-07-10T00:00:00Z' }, 'call')).toBe('2026-07-10T00:00:00Z')
  })
  it('returns null when nothing matches', () => {
    expect(occurredAt({}, 'note')).toBe(null)
  })
})

describe('snippet', () => {
  it('uses call note, then outcome, then a duration fallback', () => {
    expect(snippet({ note: 'Left VM' }, 'call')).toBe('Left VM')
    expect(snippet({ outcome: 'No answer' }, 'call')).toBe('No answer')
    expect(snippet({ duration: 42 }, 'call')).toBe('Call · 42s')
    expect(snippet({}, 'call')).toBe('Call')
  })
  it('uses text body and email subject', () => {
    expect(snippet({ message: 'Got the docs' }, 'text')).toBe('Got the docs')
    expect(snippet({ subject: 'Pre-approval' }, 'email')).toBe('Pre-approval')
  })
})

describe('mapActivity', () => {
  const contactIdByExternal = new Map([['501', 'uuid-contact']])
  it('namespaces external_id by type and resolves contact_id from personId', () => {
    const row = mapActivity(
      { id: 12, personId: 501, created: '2026-07-12T14:00:00Z', note: 'Discussed FHA' },
      'call',
      contactIdByExternal,
    )
    expect(row).toMatchObject({
      business_id: 'bay',
      source_crm: 'fub',
      external_id: 'call-12',
      type: 'call',
      contact_id: 'uuid-contact',
      occurred_at: '2026-07-12T14:00:00Z',
      notes: 'Discussed FHA',
    })
    expect(row.raw).toEqual({ id: 12, personId: 501, created: '2026-07-12T14:00:00Z', note: 'Discussed FHA' })
  })
  it('leaves contact_id null when personId is unknown or missing', () => {
    expect(mapActivity({ id: 9, personId: 999, created: 'x' }, 'note', contactIdByExternal).contact_id).toBe(null)
    expect(mapActivity({ id: 9, created: 'x' }, 'note', contactIdByExternal).contact_id).toBe(null)
  })
})
