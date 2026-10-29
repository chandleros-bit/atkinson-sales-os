import { describe, it, expect } from 'vitest'
import { THEMES, themeOf, themeItem, buildThemeList, themeForDay } from './dialThemes'

// 2026-10-26 is a Monday.
const at = (d, h = 9) => new Date(2026, 9, d, h).getTime()
const iso = (t) => new Date(t).toISOString()
const DAY = 86_400_000
const person = (o = {}) => ({ id: 'p', business_id: 'bay', name: 'Ana Ruiz', phone: '1', stage: null, person_stage: 'Lead', tags: [], crm_created_at: iso(at(1)), stage_since: null, outbound_calls: 0, last_outbound_call_at: null, pre_approved_at: null, ...o })

describe('themeOf', () => {
  it('puts each person on one theme, top partner first', () => {
    expect(themeOf(person({ person_stage: 'Realtors', crm_created_at: iso(at(20)) }), at(28))).toBe('new_realtor')
    expect(themeOf(person({ person_stage: 'Realtors', crm_created_at: iso(at(20) - 120 * DAY) }), at(28))).toBe(null)
    expect(themeOf(person({ person_stage: 'Realtors', tags: ['top partner'] }), at(28))).toBe('top_partner')
    expect(themeOf(person({ stage: 'Disclosed', tags: ['disclosed', 'under contract'] }), at(28))).toBe('loan_status')
    expect(themeOf(person({ stage: 'Application Received', tags: ['under contract'] }), at(28))).toBe('loan_status')
    expect(themeOf(person({ stage: 'Application Received', tags: ['pre-approved'] }), at(28))).toBe('pre_approved')
    expect(themeOf(person({ person_stage: 'Closed' }), at(28))).toBe('past_client')
    expect(themeOf(person({ stage: 'Attempted' }), at(28))).toBe(null)
    expect(themeOf(person({ business_id: 'mpg', tags: ['top partner'] }), at(28))).toBe(null)
  })
})

describe('themeItem rhythm', () => {
  const now = at(28, 12)
  it('new realtor: intro call, then 7, 14, then 30 days apart', () => {
    const r = person({ person_stage: 'Realtors', crm_created_at: iso(at(20)) })
    expect(themeItem(r, now)).toMatchObject({ kind: 'new_realtor', dueAt: at(20), label: 'New realtor · intro call', hint: 'never called', textKey: 'new_realtor' })
    expect(themeItem({ ...r, outbound_calls: 1, last_outbound_call_at: iso(at(21)) }, now)).toMatchObject({ dueAt: at(21) + 7 * DAY, label: 'New realtor · call 2' })
    expect(themeItem({ ...r, outbound_calls: 2, last_outbound_call_at: iso(at(21)) }, now).dueAt).toBe(at(21) + 14 * DAY)
    expect(themeItem({ ...r, outbound_calls: 5, last_outbound_call_at: iso(at(21)) }, now).dueAt).toBe(at(21) + 30 * DAY)
  })
  it('loan status weekly, past client every 90 days, pre-approved weekly, top partner every 14 days', () => {
    const last = { outbound_calls: 1, last_outbound_call_at: iso(at(20)) }
    expect(themeItem(person({ stage: 'Disclosed', ...last }), now)).toMatchObject({ kind: 'loan_status', dueAt: at(20) + 6 * DAY, label: 'Loan status update', hint: 'last call 8 days ago' })
    expect(themeItem(person({ person_stage: 'Closed', ...last }), now).dueAt).toBe(at(20) + 90 * DAY)
    expect(themeItem(person({ stage: 'Application Received', tags: ['pre-approved'], ...last }), now).dueAt).toBe(at(20) + 7 * DAY)
    expect(themeItem(person({ tags: ['top partner'], person_stage: 'Realtors', ...last }), now).dueAt).toBe(at(20) + 14 * DAY)
  })
  it('flags a pre-approval 60+ days old for a fresh letter', () => {
    const pa = person({ stage: 'Application Received', tags: ['pre-approved'], pre_approved_at: iso(at(28) - 64 * DAY) })
    expect(themeItem(pa, at(28, 12)).hint).toBe('never called · pre-approved 64 days, refresh letter')
    expect(themeItem({ ...pa, pre_approved_at: null, stage_since: iso(at(28) - 10 * DAY) }, at(28, 12)).hint).toBe('never called')
  })
})

describe('buildThemeList', () => {
  const rows = [
    person({ id: 'r1', person_stage: 'Realtors', crm_created_at: iso(at(20)) }),
    person({ id: 'r2', person_stage: 'Realtors', crm_created_at: iso(at(22)) }),
    person({ id: 'r3', person_stage: 'Realtors', crm_created_at: iso(at(22)), outbound_calls: 1, last_outbound_call_at: iso(at(26, 10)) }),
    person({ id: 'tp', person_stage: 'Realtors', tags: ['top partner'] }),
    person({ id: 'pc', person_stage: 'Closed' }),
  ]
  it("is today's theme, due people only, most overdue first", () => {
    const list = buildThemeList(rows, { now: at(26, 12) }) // Monday
    expect(list.theme.key).toBe('new_realtor')
    expect(list.items.map((i) => i.id)).toEqual(['r1', 'r2'])
  })
  it('caps the list and reports the total', () => {
    const many = Array.from({ length: 20 }, (_, i) => person({ id: `p${i}`, person_stage: 'Closed' }))
    const list = buildThemeList(many, { now: at(28, 12) }) // Wednesday
    expect(list.items).toHaveLength(15)
    expect(list.total).toBe(20)
  })
  it('previews another weekday as of that day, and counts every weekday', () => {
    const list = buildThemeList(rows, { now: at(26, 12), day: 5 })
    expect(list.theme.key).toBe('top_partner')
    expect(list.items.map((i) => i.id)).toEqual(['tp'])
    const counts = Object.fromEntries(list.week.map((w) => [w.key, w.count]))
    expect(counts).toEqual({ new_realtor: 2, loan_status: 0, past_client: 1, pre_approved: 0, top_partner: 1 })
    expect(list.week.find((w) => w.isToday).day).toBe(1)
  })
  it('has no theme on weekends and honors skips and the book filter', () => {
    expect(buildThemeList(rows, { now: new Date(2026, 9, 31, 12).getTime() }).theme).toBe(null)
    expect(buildThemeList(rows, { now: at(26, 12), skips: new Set(['r1']) }).items.map((i) => i.id)).toEqual(['r2'])
    expect(buildThemeList(rows, { now: at(26, 12), inBook: (b) => b === 'mpg' }).items).toEqual([])
  })
})

describe('themeForDay', () => {
  it('maps Monday..Friday', () => {
    expect(THEMES.map((t) => t.day)).toEqual([1, 2, 3, 4, 5])
    expect(themeForDay(3).key).toBe('past_client')
    expect(themeForDay(0)).toBe(null)
  })
})
