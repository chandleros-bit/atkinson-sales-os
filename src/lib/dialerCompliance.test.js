import { describe, it, expect } from 'vitest'
import { zonesFor, callingWindow, canDial, recentCount, MAX_PER_DAY } from './dialerCompliance'

// Instants are UTC; November 2026 is standard time (CST = UTC-6, EST = UTC-5,
// MST = UTC-7, PST = UTC-8). Nov 21 2026 is a Saturday, Nov 22 a Sunday.
const utc = (s) => Date.parse(`${s}Z`)

describe('zonesFor', () => {
  it('uses the mapped state', () => {
    expect(zonesFor({ state: 'TX', phone_e164: '+12125550101' })).toEqual(['America/Chicago'])
    expect(zonesFor({ state: 'Florida', phone_e164: '+17135550101' })).toEqual(['America/New_York'])
    expect(zonesFor({ state: ' ca ', phone_e164: null })).toEqual(['America/Los_Angeles'])
  })
  it('lets an area code in that state narrow a split state', () => {
    expect(zonesFor({ state: 'TX', phone_e164: '+19155550101' })).toEqual(['America/Denver']) // El Paso
    expect(zonesFor({ state: 'FL', phone_e164: '+18505550101' })).toEqual(['America/New_York', 'America/Chicago']) // panhandle
  })
  it('falls back to the area code when there is no state', () => {
    expect(zonesFor({ state: null, phone_e164: '+17135550101' })).toEqual(['America/Chicago'])
    expect(zonesFor({ state: '', phone_e164: '+13055550101' })).toEqual(['America/New_York'])
    expect(zonesFor({ state: 'ZZ', phone_e164: '+16025550101' })).toEqual(['America/Phoenix'])
  })
  it('assumes every continental zone when nothing is known', () => {
    expect(zonesFor({ state: null, phone_e164: '+442079460958' })).toEqual([
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    ])
  })
})

describe('callingWindow', () => {
  const tx = ['America/Chicago']
  it('allows Mon-Sat 9 AM to 8 PM local', () => {
    expect(callingWindow(tx, utc('2026-11-20T15:00')).ok).toBe(true) // Fri 9:00 CST
    expect(callingWindow(tx, utc('2026-11-20T14:59')).ok).toBe(false) // Fri 8:59
    expect(callingWindow(tx, utc('2026-11-21T01:59')).ok).toBe(true) // Fri 7:59 PM
    expect(callingWindow(tx, utc('2026-11-21T02:00')).ok).toBe(false) // Fri 8:00 PM
  })
  it('allows Sunday from noon', () => {
    expect(callingWindow(tx, utc('2026-11-22T17:59')).ok).toBe(false) // Sun 11:59 AM
    expect(callingWindow(tx, utc('2026-11-22T18:00')).ok).toBe(true) // Sun noon
  })
  it('says why and when it opens', () => {
    const w = callingWindow(tx, utc('2026-11-21T03:30')) // Fri 9:30 PM CST
    expect(w.ok).toBe(false)
    expect(w.reason).toMatch(/9:30 PM/)
    expect(w.reason).toMatch(/Central/)
    expect(w.opensAt).toBe(utc('2026-11-21T15:00')) // Sat 9 AM CST
  })
  it('opens Sunday at noon after a Saturday night', () => {
    expect(callingWindow(tx, utc('2026-11-22T04:00')).opensAt).toBe(utc('2026-11-22T18:00'))
  })
  it('needs every possible zone inside the window', () => {
    const fl = ['America/New_York', 'America/Chicago']
    expect(callingWindow(fl, utc('2026-11-20T14:30')).ok).toBe(false) // 9:30 ET, 8:30 CT
    expect(callingWindow(fl, utc('2026-11-20T15:00')).ok).toBe(true) // 10 ET, 9 CT
    expect(callingWindow(fl, utc('2026-11-21T00:59')).ok).toBe(true) // 7:59 PM ET
    expect(callingWindow(fl, utc('2026-11-21T01:00')).ok).toBe(false) // 8 PM ET
    expect(callingWindow(fl, utc('2026-11-20T14:30')).opensAt).toBe(utc('2026-11-20T15:00'))
  })
})

describe('3 calls in 24 hours', () => {
  const now = utc('2026-11-20T20:00')
  const calls = [
    { phone_e164: '+17135550101', dialed_at: '2026-11-19T21:00:00Z' },
    { phone_e164: '+17135550101', dialed_at: '2026-11-20T10:00:00Z' },
    { phone_e164: '+17135550101', dialed_at: '2026-11-20T15:00:00Z' },
    { phone_e164: '+17135550101', dialed_at: '2026-11-19T19:00:00Z' }, // over 24 h ago
    { phone_e164: '+17135550199', dialed_at: '2026-11-20T15:00:00Z' },
  ]
  it('counts dials to the number in the trailing 24 hours', () => {
    expect(recentCount(calls, '+17135550101', now)).toBe(3)
    expect(recentCount(calls, '+17135550199', now)).toBe(1)
    expect(MAX_PER_DAY).toBe(3)
  })
})

describe('canDial', () => {
  const lead = { state: 'TX', phone_e164: '+17135550101' }
  const fri10am = utc('2026-11-20T16:00')
  const fri9pm = utc('2026-11-21T03:00')
  it('applies the hours guard to Cold lists only', () => {
    expect(canDial(lead, { cold: true, hoursGuard: true, calls: [], now: fri9pm }).ok).toBe(false)
    expect(canDial(lead, { cold: false, hoursGuard: true, calls: [], now: fri9pm }).ok).toBe(true)
    expect(canDial(lead, { cold: true, hoursGuard: false, calls: [], now: fri9pm }).ok).toBe(true)
    expect(canDial(lead, { cold: true, hoursGuard: true, calls: [], now: fri10am }).ok).toBe(true)
  })
  it('blocks a 4th dial in 24 hours on any list, and says when it frees up', () => {
    const calls = ['2026-11-19T18:00:00Z', '2026-11-20T10:00:00Z', '2026-11-20T15:00:00Z']
      .map((d) => ({ phone_e164: '+17135550101', dialed_at: d }))
    const r = canDial(lead, { cold: false, hoursGuard: true, calls, now: fri10am })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/3 calls/)
    expect(r.opensAt).toBe(utc('2026-11-20T18:00'))
  })
})
