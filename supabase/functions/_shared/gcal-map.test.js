import { describe, it, expect } from 'vitest'
import { googleEventId, toGoogleEvent, planSync, hashString, MASS_DELETE_GUARD, dialerCallbackEventRow } from './gcal-map.ts'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (n, extra = {}) => ({
  id: uuid(n),
  business_id: 'bay',
  kind: 'call',
  starts_at: '2026-11-17T20:30:00.000Z',
  duration_min: 30,
  note: null,
  remind_min: 10,
  status: 'scheduled',
  contacts: { name: 'Jane Doe', phone: '713-555-0100', email: null },
  ...extra,
})
const W0 = Date.parse('2026-11-14T00:00:00Z')
const W1 = Date.parse('2027-01-15T00:00:00Z')
const asExisting = (ev) => ({ id: ev.id, start: ev.start, extendedProperties: ev.extendedProperties })

describe('googleEventId', () => {
  it('is stable and uses only base32hex characters', () => {
    const id = googleEventId(uuid(7))
    expect(id).toBe(googleEventId(uuid(7)))
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/)
  })
  it('rejects anything that is not a uuid', () => {
    expect(() => googleEventId('nope')).toThrow(/uuid/)
  })
})

describe('toGoogleEvent', () => {
  it('builds a titled, colored, timed event with its reminder', () => {
    const ev = toGoogleEvent(row(1, { note: 'Rate quote' }))
    expect(ev.summary).toBe('Call: Jane Doe (Bayway)')
    expect(ev.colorId).toBe('10')
    expect(ev.start).toEqual({ dateTime: '2026-11-17T20:30:00.000Z', timeZone: 'America/Chicago' })
    expect(ev.end.dateTime).toBe('2026-11-17T21:00:00.000Z')
    expect(ev.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] })
    expect(ev.description).toContain('Rate quote')
    expect(ev.description).toContain('713-555-0100')
    expect(ev.extendedProperties.private).toMatchObject({ source: 'sales-os', contact_event_id: uuid(1) })
  })
  it('uses MPG blue and no reminder when remind_min is null', () => {
    const ev = toGoogleEvent(row(2, { business_id: 'mpg', kind: 'follow_up', remind_min: null, duration_min: 15 }))
    expect(ev.summary).toBe('Follow-up: Jane Doe (MPG)')
    expect(ev.colorId).toBe('9')
    expect(ev.reminders.overrides).toEqual([])
    expect(ev.end.dateTime).toBe('2026-11-17T20:45:00.000Z')
  })
  it('marks done events and changes the hash', () => {
    const a = toGoogleEvent(row(3))
    const b = toGoogleEvent(row(3, { status: 'done' }))
    expect(b.summary.startsWith('✓ ')).toBe(true)
    expect(b.extendedProperties.private.hash).not.toBe(a.extendedProperties.private.hash)
  })
})

describe('planSync', () => {
  it('creates new rows, skips unchanged, updates changed', () => {
    const unchanged = toGoogleEvent(row(1))
    const changedOld = toGoogleEvent(row(2))
    const rows = [row(1), row(2, { starts_at: '2026-11-18T15:00:00.000Z' }), row(3)]
    const plan = planSync(rows, [asExisting(unchanged), asExisting(changedOld)], W0, W1)
    expect(plan.creates.map((e) => e.id)).toEqual([googleEventId(uuid(3))])
    expect(plan.updates.map((e) => e.id)).toEqual([googleEventId(uuid(2))])
    expect(plan.deletes).toEqual([])
  })
  it('deletes canceled and removed rows, keeps done ones', () => {
    const canceled = toGoogleEvent(row(1))
    const removed = toGoogleEvent(row(2))
    const done = toGoogleEvent(row(3, { status: 'done' }))
    const plan = planSync(
      [row(1, { status: 'canceled' }), row(3, { status: 'done' })],
      [asExisting(canceled), asExisting(removed), asExisting(done)],
      W0,
      W1,
    )
    expect(plan.deletes.sort()).toEqual([googleEventId(uuid(1)), googleEventId(uuid(2))].sort())
    expect(plan.creates).toEqual([])
    expect(plan.updates).toEqual([])
  })
  it('never deletes an event that starts outside the window', () => {
    const early = toGoogleEvent(row(1, { starts_at: '2026-11-13T23:45:00.000Z' }))
    expect(planSync([], [asExisting(early)], W0, W1).deletes).toEqual([])
  })
  it('refuses a mass delete when the DB read comes back empty', () => {
    const existing = Array.from({ length: MASS_DELETE_GUARD + 1 }, (_, i) => asExisting(toGoogleEvent(row(i + 1))))
    expect(() => planSync([], existing, W0, W1)).toThrow(/refusing/)
  })
})

describe('hashString', () => {
  it('is deterministic and 8 hex chars', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('dialerCallbackEventRow', () => {
  const cb = {
    id: uuid(77), business_id: 'mpg', callback_at: '2026-11-21T16:30:00.000Z', notes: 'Wants a rate review',
    dialer_leads: { first_name: 'Jane', last_name: 'Smith', company: 'Acme Cafe', phone_e164: '+17135550101', email: null },
  }
  it('becomes a 15-minute call event with a reminder, through planSync', () => {
    const ev = toGoogleEvent(dialerCallbackEventRow(cb))
    expect(ev.id).toBe(googleEventId(uuid(77)))
    expect(ev.summary).toBe('Call: Jane Smith (MPG)')
    expect(ev.start.dateTime).toBe('2026-11-21T16:30:00.000Z')
    expect(ev.end.dateTime).toBe('2026-11-21T16:45:00.000Z')
    expect(ev.description).toContain('Power Dialer callback (Acme Cafe): Wants a rate review')
    expect(ev.description).toContain('Phone: +17135550101')
    expect(ev.reminders.overrides).toEqual([{ method: 'popup', minutes: 10 }])
    const plan = planSync([dialerCallbackEventRow(cb)], [], Date.parse('2026-11-20T00:00:00Z'), Date.parse('2026-12-20T00:00:00Z'))
    expect(plan.creates.map((e) => e.id)).toEqual([googleEventId(uuid(77))])
  })
  it('names the company when there is no person', () => {
    const ev = toGoogleEvent(dialerCallbackEventRow({ ...cb, notes: null, dialer_leads: { company: 'Acme Cafe' } }))
    expect(ev.summary).toBe('Call: Acme Cafe (MPG)')
    expect(ev.description.split(String.fromCharCode(10))[0]).toBe('Power Dialer callback')
  })
})
