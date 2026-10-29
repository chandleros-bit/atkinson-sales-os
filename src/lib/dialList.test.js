import { describe, it, expect } from 'vitest'
import { attemptDue, businessDay, dialItem, buildDialList, whenLabel, ATTEMPTS } from './dialList'

// Local wall-clock instants. 2026-10-26 is a Monday.
const at = (d, h = 9, m = 0) => new Date(2026, 9, d, h, m).getTime()
const iso = (t) => new Date(t).toISOString()
const DAY = 86_400_000
const lead = (o = {}) => ({
  id: 'l1', business_id: 'bay', name: 'Sam Golden', phone: '9137135946', stage: 'New Lead', stage_since: null,
  crm_created_at: iso(at(26, 9)), tags: [], outbound_calls: 0, outbound_calls_since_stage: 0,
  first_outbound_call_at: null, last_outbound_call_at: null, connected_at: null, ...o,
})
const called = (n, first, last = first) => ({ outbound_calls: n, first_outbound_call_at: iso(first), last_outbound_call_at: iso(last), stage: 'Attempted' })

describe('businessDay', () => {
  it('moves Saturday and Sunday to Monday, same time', () => {
    expect(businessDay(at(31, 10))).toBe(new Date(2026, 10, 2, 10).getTime()) // Sat -> Mon
    expect(businessDay(new Date(2026, 10, 1, 10).getTime())).toBe(new Date(2026, 10, 2, 10).getTime()) // Sun -> Mon
    expect(businessDay(at(28, 10))).toBe(at(28, 10))
  })
})

describe('attemptDue', () => {
  it('spaces attempts from attempt 1: +3h, next business day opposite half, day 3, 5, 8', () => {
    const first = at(26, 10) // Mon 10 AM
    expect(attemptDue(2, first)).toBe(at(26, 13))
    expect(attemptDue(3, first)).toBe(at(27, 14)) // morning first, so afternoon
    expect(attemptDue(3, at(26, 15))).toBe(at(27, 9)) // afternoon first, so morning
    expect(attemptDue(4, first)).toBe(at(29, 9))
    expect(attemptDue(5, first)).toBe(new Date(2026, 10, 2, 9).getTime()) // Sat 10/31 -> Mon 11/2
    expect(attemptDue(6, first)).toBe(new Date(2026, 10, 3, 9).getTime())
  })
  it('pushes a late-evening attempt 2 to the next business day morning', () => {
    expect(attemptDue(2, at(30, 18))).toBe(new Date(2026, 10, 2, 9).getTime()) // Fri 6 PM -> Mon 9 AM
  })
})

describe('dialItem: lead attempts', () => {
  it('a new, never-called lead is attempt 1, due from when it arrived', () => {
    expect(dialItem(lead(), at(26, 9, 3))).toMatchObject({ kind: 'attempt', step: 1, dueAt: at(26, 9), label: 'Attempt 1', textKey: 'a1', book: 'bay' })
  })
  it('counts attempts from the call history and schedules the next', () => {
    const it2 = dialItem(lead(called(1, at(26, 10))), at(26, 11))
    expect(it2).toMatchObject({ step: 2, dueAt: at(26, 13), textKey: null })
    const it3 = dialItem(lead(called(2, at(26, 10), at(26, 13))), at(27, 8))
    expect(it3).toMatchObject({ step: 3, dueAt: at(27, 14), hint: 'try afternoon', textKey: 'a3' })
  })
  it('never makes the next attempt due within 2 hours of the last call', () => {
    const it4 = dialItem(lead(called(3, at(26, 10), at(29, 8))), at(29, 8, 30))
    expect(it4.dueAt).toBe(at(29, 10))
  })
  it('ends the cadence on a connected call or a stage past Attempted', () => {
    expect(dialItem(lead({ ...called(2, at(26, 10)), connected_at: iso(at(26, 13)) }), at(27))).toBe(null)
    expect(dialItem(lead({ stage: 'Contacted/Working' }), at(27))).toBe(null)
  })
  it('after six Bayway attempts asks to move the lead to Nurture', () => {
    const sixth = new Date(2026, 10, 3, 9).getTime()
    expect(dialItem(lead(called(ATTEMPTS, at(26, 10), sixth)), sixth + 3 * 3_600_000)).toMatchObject({ kind: 'move_nurture', step: 6, dueAt: sixth, label: '6 attempts, move to Nurture' })
  })
})

describe('dialItem: MPG runs on calls alone', () => {
  const mpg = (o) => lead({ business_id: 'mpg', stage: 'Open', ...o })
  it('uses Open / Not Contacted / Attempted to Contact as the cadence and stops on any other status', () => {
    expect(dialItem(mpg(), at(26, 9, 1))).toMatchObject({ kind: 'attempt', step: 1 })
    expect(dialItem(mpg({ ...called(2, at(26, 10)), stage: 'Attempted to Contact' }), at(27))).toMatchObject({ step: 3 })
    expect(dialItem(mpg({ stage: 'Contacted' }), at(27))).toBe(null)
  })
  it('after six calls: two weekly nurture calls, then cold every 30 days', () => {
    const last = at(28, 10)
    expect(dialItem(mpg({ ...called(6, at(20, 10), last), stage: 'Open' }), at(28, 11))).toMatchObject({ kind: 'nurture', label: 'Nurture call 1 of 2', dueAt: last + 7 * DAY, textKey: 'nurture' })
    expect(dialItem(mpg({ ...called(7, at(13, 10), last), stage: 'Open' }), at(28, 11))).toMatchObject({ label: 'Nurture call 2 of 2' })
    expect(dialItem(mpg({ ...called(8, at(6, 10), last), stage: 'Open' }), at(28, 11))).toMatchObject({ kind: 'cold', label: 'Cold check-in', dueAt: businessDay(last + 30 * DAY) })
  })
})

describe('dialItem: Bayway parked leads', () => {
  const parked = (o) => lead({ stage: 'Nurture / Credit Repair', stage_since: iso(at(20, 9)), ...o })
  it('Nurture: calls 7 days apart, twice, then cold', () => {
    expect(dialItem(parked({ tags: ['nurture'] }), at(27))).toMatchObject({ kind: 'nurture', label: 'Nurture call 1 of 2', dueAt: at(27, 9) })
    expect(dialItem(parked({ tags: ['nurture'], outbound_calls_since_stage: 1, last_outbound_call_at: iso(at(27, 11)) }), at(28))).toMatchObject({ label: 'Nurture call 2 of 2', dueAt: businessDay(at(27, 11) + 7 * DAY) })
    expect(dialItem(parked({ tags: ['nurture'], outbound_calls_since_stage: 2, last_outbound_call_at: iso(at(27, 11)) }), at(28))).toMatchObject({ kind: 'cold', dueAt: businessDay(at(27, 11) + 30 * DAY) })
  })
  it('Credit Repair: a check-in 30 days after the later of parking and the last call', () => {
    expect(dialItem(parked({ tags: ['credit repair'] }), at(27))).toMatchObject({ kind: 'credit_repair', label: 'Credit repair check-in', dueAt: businessDay(at(20, 9) + 30 * DAY), textKey: 'credit_repair' })
  })
})

describe('buildDialList', () => {
  const now = at(28, 12)
  const rows = [
    lead({ id: 'later', ...called(1, at(28, 10)) }), // attempt 2 due 1 PM today
    lead({ id: 'new', crm_created_at: iso(at(28, 11, 55)) }), // attempt 1, speed to lead
    lead({ id: 'over', ...called(3, at(23, 10), at(26, 10)) }), // attempt 4 due 10/26... overdue
    lead({ id: 'tomorrow', ...called(2, at(28, 9), at(28, 11)) }), // attempt 3 due tomorrow
    lead({ id: 'mpg', business_id: 'mpg', stage: 'Open' }),
  ]
  it('keeps what is due by the end of today: due now first (new leads on top), then later today', () => {
    const list = buildDialList(rows, { now })
    expect(list.dueNow.map((i) => i.id)).toEqual(['new', 'mpg', 'over'])
    expect(list.laterToday.map((i) => i.id)).toEqual(['later'])
  })
  it('drops skipped leads and other books', () => {
    const list = buildDialList(rows, { now, skips: new Set(['new']), inBook: (b) => b === 'bay' })
    expect(list.dueNow.map((i) => i.id)).toEqual(['over'])
  })
})

describe('whenLabel', () => {
  it('says due now, overdue days, or the time later today', () => {
    expect(whenLabel({ dueAt: at(28, 11) }, at(28, 12))).toBe('due now')
    expect(whenLabel({ dueAt: at(25, 9) }, at(28, 12))).toBe('3 days late')
    expect(whenLabel({ dueAt: at(28, 14, 30) }, at(28, 12))).toBe('2:30 PM')
  })
})
