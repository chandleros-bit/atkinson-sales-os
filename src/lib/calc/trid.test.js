import { describe, it, expect } from 'vitest'
import { federalHolidays, isGeneralBusinessDay, isSpecificBusinessDay, addBizDays, tridDates } from './trid'

describe('federalHolidays', () => {
  it('2026 observed dates', () => {
    const h = federalHolidays(2026)
    for (const d of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25']) {
      expect(h.has(d)).toBe(true)
    }
    expect(h.has('2026-07-04')).toBe(false)
  })
  it('a Saturday New Year is observed the Friday before, in the prior year', () => {
    expect(federalHolidays(2022).has('2021-12-31')).toBe(true) // Jan 1 2022 was a Saturday
    expect(isGeneralBusinessDay('2021-12-31')).toBe(false)
  })
})

describe('business days', () => {
  it('general: weekdays without holidays; specific: all but Sundays and holidays', () => {
    expect(isGeneralBusinessDay('2026-11-28')).toBe(false) // Saturday
    expect(isSpecificBusinessDay('2026-11-28')).toBe(true)
    expect(isSpecificBusinessDay('2026-11-29')).toBe(false) // Sunday
    expect(isSpecificBusinessDay('2026-11-26')).toBe(false) // Thanksgiving
  })
  it('addBizDays goes back with a negative count', () => {
    expect(addBizDays('2026-12-28', -3, isSpecificBusinessDay)).toBe('2026-12-23')
  })
})

describe('tridDates', () => {
  it('application Mon Nov 23 2026, delivered in person', () => {
    const t = tridDates({ application: '2026-11-23', mailed: false, closing: '2026-12-28' })
    expect(t.leBy).toBe('2026-11-27') // skips Thanksgiving
    expect(t.leReceived).toBe('2026-11-27')
    expect(t.earliestClosing).toBe('2026-12-05') // skips Sunday Nov 29
    expect(t.cdReceiveBy).toBe('2026-12-23') // skips Sunday and Christmas
    expect(t.cdSendBy).toBe('2026-12-23')
  })
  it('mailed adds 3 specific business days each way', () => {
    const t = tridDates({ application: '2026-11-23', mailed: true, closing: '2026-12-28' })
    expect(t.leReceived).toBe('2026-12-01')
    expect(t.cdSendBy).toBe('2026-12-19')
  })
  it('no closing date, no Closing Disclosure dates', () => {
    const t = tridDates({ application: '2026-11-23', mailed: false, closing: null })
    expect(t.cdReceiveBy).toBe(null)
    expect(t.cdSendBy).toBe(null)
  })
})
