import { describe, it, expect } from 'vitest'
import { chicagoParts, shouldSend, chicagoDayRangeUtc, businessDaysLeft, longDateLabel, previousBusinessDateKey, previousBusinessDayRangeUtc } from './briefingTime'

// UTC instants; Chicago is UTC-5 in CDT (until Nov 1 2026) and UTC-6 in CST.
const at = (iso) => new Date(iso).getTime()

describe('chicagoParts', () => {
  it('reads date, hour and weekday in America/Chicago', () => {
    expect(chicagoParts(at('2026-11-04T13:30:00Z'))).toEqual({ dateKey: '2026-11-04', hour: 7, minute: 30, weekday: 3 })
    expect(chicagoParts(at('2026-10-28T12:30:00Z'))).toEqual({ dateKey: '2026-10-28', hour: 7, minute: 30, weekday: 3 })
    expect(chicagoParts(at('2026-11-05T03:00:00Z'))).toMatchObject({ dateKey: '2026-11-04', hour: 21 })
  })
})

describe('shouldSend', () => {
  it('weekdays at 7:xx and 8:xx Chicago (8:xx retries a failed 7:xx run)', () => {
    expect(shouldSend(at('2026-11-04T13:30:00Z'))).toBe(true) // Wed 7:30 CST
    expect(shouldSend(at('2026-11-04T12:30:00Z'))).toBe(false) // Wed 6:30 CST
    expect(shouldSend(at('2026-10-28T12:30:00Z'))).toBe(true) // Wed 7:30 CDT
    expect(shouldSend(at('2026-10-28T13:30:00Z'))).toBe(true) // Wed 8:30 CDT
    expect(shouldSend(at('2026-11-04T14:30:00Z'))).toBe(true) // Wed 8:30 CST
    expect(shouldSend(at('2026-11-04T15:30:00Z'))).toBe(false) // Wed 9:30 CST
    expect(shouldSend(at('2026-10-28T14:30:00Z'))).toBe(false) // Wed 9:30 CDT
    expect(shouldSend(at('2026-11-07T13:30:00Z'))).toBe(false) // Saturday
  })
})

describe('chicagoDayRangeUtc', () => {
  it('gives the UTC ISO bounds of a Chicago calendar day, with an offset in days', () => {
    expect(chicagoDayRangeUtc(at('2026-11-04T13:30:00Z'))).toEqual({ from: '2026-11-04T06:00:00.000Z', to: '2026-11-05T06:00:00.000Z' })
    expect(chicagoDayRangeUtc(at('2026-11-04T13:30:00Z'), -1)).toEqual({ from: '2026-11-03T06:00:00.000Z', to: '2026-11-04T06:00:00.000Z' })
    // Across the DST change: Sunday Nov 1 2026 is 25 hours long.
    expect(chicagoDayRangeUtc(at('2026-11-02T13:30:00Z'), -1)).toEqual({ from: '2026-11-01T05:00:00.000Z', to: '2026-11-02T06:00:00.000Z' })
  })
})

describe('businessDaysLeft', () => {
  it('counts Mon-Fri from today (inclusive) to month end, Chicago calendar', () => {
    expect(businessDaysLeft(at('2026-11-04T13:30:00Z'))).toBe(19) // Nov 4-30 2026
    expect(businessDaysLeft(at('2026-11-30T13:30:00Z'))).toBe(1)
  })
})

describe('longDateLabel', () => {
  it('formats the subject date', () => {
    expect(longDateLabel(at('2026-11-03T13:30:00Z'))).toBe('Tue Nov 3')
  })
})

describe('previousBusinessDateKey', () => {
  it('is yesterday midweek and Friday on Monday (Chicago calendar)', () => {
    expect(previousBusinessDateKey(at('2026-11-09T13:30:00Z'))).toBe('2026-11-06') // Mon -> Fri
    expect(previousBusinessDateKey(at('2026-11-04T13:30:00Z'))).toBe('2026-11-03') // Wed -> Tue
    expect(previousBusinessDateKey(at('2026-11-06T13:30:00Z'))).toBe('2026-11-05') // Fri -> Thu
  })
})

describe('previousBusinessDayRangeUtc', () => {
  it('bounds that Chicago day in UTC', () => {
    expect(previousBusinessDayRangeUtc(at('2026-11-09T13:30:00Z'))).toEqual({ from: '2026-11-06T06:00:00.000Z', to: '2026-11-07T06:00:00.000Z' })
    expect(previousBusinessDayRangeUtc(at('2026-11-04T13:30:00Z'))).toEqual({ from: '2026-11-03T06:00:00.000Z', to: '2026-11-04T06:00:00.000Z' })
  })
})
