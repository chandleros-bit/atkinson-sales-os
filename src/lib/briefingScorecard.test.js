import { describe, it, expect } from 'vitest'
import { callConnected, yesterdayScorecard, needPerDay } from './briefingScorecard'

describe('callConnected (mirrors public.call_connected, migration 0049)', () => {
  it('FUB outcome, Zoho result or subject, or 2+ minutes', () => {
    expect(callConnected({ outcome: 'Interested' })).toBe(true)
    expect(callConnected({ outcome: 'Not Interested' })).toBe(true)
    expect(callConnected({ Call_Result: 'Not interested' })).toBe(true)
    expect(callConnected({ Subject: 'Call: Interested' })).toBe(true)
    expect(callConnected({ duration: '120' })).toBe(true)
    expect(callConnected({ duration: 119 })).toBe(false)
    expect(callConnected({ duration: '119' })).toBe(false)
    expect(callConnected({ Call_Duration: '2:00' })).toBe(true)
    expect(callConnected({ Call_Duration: '1:59' })).toBe(false)
    expect(callConnected({ outcome: 'No Answer' })).toBe(false)
    expect(callConnected(null)).toBe(false)
  })
})

describe('yesterdayScorecard', () => {
  it('counts outbound calls, connects, texts and new applications', () => {
    const acts = [
      { type: 'call', direction: 'outbound', raw: { outcome: 'Interested' } },
      { type: 'call', direction: 'outbound', raw: { outcome: 'No Answer' } },
      { type: 'call', direction: 'inbound', raw: { outcome: 'Interested' } },
      { type: 'text', direction: 'outbound', raw: {} },
    ]
    const apps = [{ stage: 'Application Received', stage_since: '2026-11-03T15:00:00Z' }]
    expect(yesterdayScorecard({ activities: acts, newApplications: apps })).toEqual({ calls: 2, connects: 1, texts: 1, applications: 1 })
  })
})

describe('needPerDay', () => {
  it('is null when hit or no target, else ceil(remaining / business days left)', () => {
    expect(needPerDay({ value: 50, target: 0 }, 10)).toBe(null)
    expect(needPerDay({ value: 120, target: 100 }, 10)).toBe(null)
    expect(needPerDay({ value: 40, target: 100 }, 19)).toBe(4)
    expect(needPerDay({ value: 40, target: 100 }, 0)).toBe(60)
  })
})
