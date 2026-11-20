import { describe, it, expect } from 'vitest'
import { OUTCOMES, outcomesFor, nextAttemptAt, applyOutcome, nextLead, needsPush } from './dialerQueue'

// Local times (the app runs in Chandler's time zone; tests use the machine's).
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime() // Nov d, 2026

describe('outcomes', () => {
  it('matches the spec table', () => {
    const t = Object.fromEntries(OUTCOMES.map((o) => [o.key, [o.connect, o.status]]))
    expect(t).toEqual({
      no_answer: [false, 'retry'],
      voicemail: [false, 'retry'],
      owner_unavailable: [true, 'retry'],
      bad_number: [false, 'invalid_phone'],
      not_interested: [true, 'dead'],
      do_not_call: [true, 'dnc'],
      callback_requested: [true, 'confirmed'],
      interested: [true, 'confirmed'],
      appointment_set: [true, 'confirmed'],
      application_sent: [true, 'confirmed'],
    })
  })
  it('hides the other business-only outcome', () => {
    expect(outcomesFor('mpg').map((o) => o.key)).toContain('owner_unavailable')
    expect(outcomesFor('mpg').map((o) => o.key)).not.toContain('application_sent')
    expect(outcomesFor('bay').map((o) => o.key)).toContain('application_sent')
    expect(outcomesFor('bay').map((o) => o.key)).not.toContain('owner_unavailable')
  })
  it('sends confirmed outcomes to the push queue', () => {
    expect(['interested', 'appointment_set', 'callback_requested', 'application_sent'].every(needsPush)).toBe(true)
    expect(needsPush('no_answer')).toBe(false)
    expect(needsPush('not_interested')).toBe(false)
  })
})

describe('nextAttemptAt', () => {
  it('moves a morning miss to the afternoon, at least 4 hours on', () => {
    expect(nextAttemptAt(at(20, 10))).toBe(at(20, 14))
    expect(nextAttemptAt(at(20, 9, 15))).toBe(at(20, 13, 15))
  })
  it('waits for the afternoon when 4 hours still lands in the morning', () => {
    expect(nextAttemptAt(at(20, 7))).toBe(at(20, 12))
  })
  it('moves an afternoon miss to the next morning', () => {
    expect(nextAttemptAt(at(20, 14))).toBe(at(21, 9))
    expect(nextAttemptAt(at(20, 19, 30))).toBe(at(21, 9))
  })
  it('respects a longer minimum gap', () => {
    expect(nextAttemptAt(at(20, 10), 6)).toBe(at(20, 16))
  })
  it('finds the other half on a later day when the gap runs past today', () => {
    // 10:00 + 12h = 22:00, after the afternoon window: tomorrow's afternoon.
    expect(nextAttemptAt(at(20, 10), 12)).toBe(at(21, 12))
  })
})

describe('applyOutcome', () => {
  const lead = { attempt_count: 0 }
  const now = at(20, 10)
  it('schedules a retry and counts the attempt', () => {
    expect(applyOutcome(lead, 'no_answer', { now })).toEqual({
      status: 'retry', attempt_count: 1, last_outcome: 'no_answer', next_attempt_at: new Date(at(20, 14)).toISOString(),
    })
  })
  it('goes dead after the third miss', () => {
    expect(applyOutcome({ attempt_count: 2 }, 'voicemail', { now })).toMatchObject({ status: 'dead', attempt_count: 3, next_attempt_at: null })
  })
  it('honours a lower max attempts setting', () => {
    expect(applyOutcome({ attempt_count: 0 }, 'no_answer', { now, maxAttempts: 1 })).toMatchObject({ status: 'dead' })
  })
  it('sets the final status for other outcomes', () => {
    expect(applyOutcome(lead, 'interested', { now })).toMatchObject({ status: 'confirmed', attempt_count: 1, next_attempt_at: null })
    expect(applyOutcome(lead, 'do_not_call', { now })).toMatchObject({ status: 'dnc' })
    expect(applyOutcome(lead, 'bad_number', { now })).toMatchObject({ status: 'invalid_phone' })
    expect(applyOutcome(lead, 'not_interested', { now })).toMatchObject({ status: 'dead' })
  })
})

describe('nextLead', () => {
  const now = at(20, 15)
  const leads = [
    { id: 'r1', status: 'retry', position: 1, next_attempt_at: new Date(at(20, 14)).toISOString() },
    { id: 'q2', status: 'queued', position: 2 },
    { id: 'r3', status: 'retry', position: 3, next_attempt_at: new Date(at(21, 9)).toISOString() },
    { id: 'q4', status: 'queued', position: 4 },
    { id: 'r5', status: 'retry', position: 5, next_attempt_at: new Date(at(20, 12)).toISOString() },
    { id: 'c6', status: 'confirmed', position: 6 },
  ]
  it('serves queued leads in CSV order first', () => {
    expect(nextLead(leads, { now })?.id).toBe('q2')
    expect(nextLead(leads, { now, skip: new Set(['q2']) })?.id).toBe('q4')
  })
  it('then due retries, earliest due first', () => {
    expect(nextLead(leads, { now, skip: new Set(['q2', 'q4']) })?.id).toBe('r5')
    expect(nextLead(leads, { now, skip: new Set(['q2', 'q4', 'r5']) })?.id).toBe('r1')
  })
  it('never serves a retry that is not due or a finished lead', () => {
    expect(nextLead(leads, { now, skip: new Set(['q2', 'q4', 'r5', 'r1']) })).toBeNull()
  })
})
