import { describe, it, expect } from 'vitest'
import { cdDueOn, hardDates, loanStep, loanFlag, loansInFlight, merchantsInFlight, bookHealth, shortDay, hardDateTask } from './bookFlags'

// Monday, Nov 23 2026, 10 AM local. Thanksgiving is Thursday Nov 26.
const NOW = new Date('2026-11-23T10:00:00').getTime()
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()
const loan = (o) => ({ id: o.id, business_id: 'bay', role: 'primary', stage: 'Loan Setup', stage_group: 'processing', amount: 300000, funded_on: null, firm_closing_on: null, lock_expires_on: null, scenario_auto: false, scenario_override: null, borrower_name: 'B', ...o })

describe('closing disclosure due date', () => {
  it('counts back 3 business days, skipping weekends and holidays', () => {
    // Mon Nov 30 -> Fri 27 (1), Thanksgiving skipped, Wed 25 (2), Tue 24 (3).
    expect(cdDueOn('2026-11-30')).toBe('2026-11-24')
    // Thu Dec 10 -> Wed 9, Tue 8, Mon 7.
    expect(cdDueOn('2026-12-10')).toBe('2026-12-07')
    expect(cdDueOn(null)).toBe(null)
  })

  it('lists hard dates within 14 days, soonest first', () => {
    const loans = [
      loan({ id: 1, borrower_name: 'Lee', firm_closing_on: '2026-11-30' }),
      loan({ id: 2, borrower_name: 'Shah', lock_expires_on: '2026-12-02' }),
      loan({ id: 3, borrower_name: 'Far', firm_closing_on: '2027-02-01' }),
      loan({ id: 4, borrower_name: 'Sent', stage: 'Docs Out', stage_group: 'closing', firm_closing_on: '2026-11-25' }),
    ]
    expect(hardDates(loans, NOW).map((h) => [h.name, h.kind, h.on, h.days])).toEqual([
      ['Lee', 'cd', '2026-11-24', 1],
      ['Shah', 'lock', '2026-12-02', 9],
    ])
  })
})

describe('loans in flight', () => {
  it('maps Arive stages onto five steps', () => {
    expect(loanStep(loan({ stage: 'Pre-Approved', stage_group: 'prospect' }))).toBe(1)
    expect(loanStep(loan({ stage: 'Disclosed' }))).toBe(2)
    expect(loanStep(loan({ stage: 'Submitted to UW' }))).toBe(3)
    expect(loanStep(loan({ stage: 'Clear To Close', stage_group: 'closing' }))).toBe(4)
    expect(loanStep(loan({ stage: 'Loan Funded', stage_group: 'funded' }))).toBe(5)
  })

  it('picks the most urgent flag', () => {
    const f = (o, ctx) => loanFlag(loan({ id: 9, ...o }), { now: NOW, ...ctx })
    expect(f({ firm_closing_on: '2026-11-30' })).toEqual({ text: 'Closing disclosure due tomorrow', tone: 'neg' })
    expect(f({ firm_closing_on: '2026-11-20' }).text).toContain('overdue')
    expect(f({ firm_closing_on: '2027-01-15', lock_expires_on: '2026-12-20' })).toEqual({ text: 'Lock ends Dec 20, before closing', tone: 'neg' })
    expect(f({ lock_expires_on: '2026-11-26' })).toEqual({ text: 'Lock ends Thu', tone: 'warn' })
    const pipeById = new Map([['c1', { docs_outstanding_count: 2, docs_oldest_requested_at: daysAgo(9) }]])
    expect(f({ contact_id: 'c1' }, { pipeById })).toEqual({ text: '2 docs requested 9 days ago', tone: 'warn' })
    const partners = [{ name: 'Jenna Kim', email: 'JK@x.com', last_touch_at: daysAgo(8) }]
    expect(f({ buyer_agent_email: 'jk@x.com' }, { partners })).toEqual({ text: 'Agent Jenna Kim not updated in 8 days', tone: 'warn' })
    expect(f({ buyer_agent_email: 'jk@x.com' }, { partners: [{ ...partners[0], last_touch_at: daysAgo(2) }] })).toEqual({ text: 'On track', tone: 'ok' })
  })

  it('counts by step and lists the 5 closing soonest', () => {
    const loans = [
      loan({ id: 'a', stage: 'Pre-Approved', stage_group: 'prospect' }),
      loan({ id: 'b', stage: 'Submitted to UW', firm_closing_on: '2026-12-18' }),
      loan({ id: 'c', stage: 'Clear To Close', stage_group: 'closing', firm_closing_on: '2026-12-04' }),
      loan({ id: 'd', stage: 'Loan Funded', stage_group: 'funded', funded_on: '2026-11-10' }),
      loan({ id: 'e', stage: 'Loan Funded', stage_group: 'funded', funded_on: '2026-10-10' }),
      loan({ id: 'f', scenario_auto: true }),
      loan({ id: 'g', role: 'assisted' }),
    ]
    const r = loansInFlight({ loans, now: NOW })
    expect(r.counts).toEqual({ application: 1, processing: 0, underwriting: 1, ctc: 1, funded: 1 })
    expect(r.rows.map((x) => x.id)).toEqual(['c', 'b', 'a'])
    expect(r.open).toBe(3)
  })
})

describe('merchants in flight', () => {
  it('counts open stages and ranks by urgency', () => {
    const mpgRows = [
      { id: 'm1', company: 'Harbor Grill', name: 'Ana', stage: 'Submitted', stage_since: daysAgo(3), last_touch_at: daysAgo(1) },
      { id: 'm2', company: 'Ace Auto', stage: 'Open', stage_since: daysAgo(2), last_touch_at: daysAgo(10) },
      { id: 'm3', company: 'Lone Star', stage: 'Approved', stage_since: daysAgo(1), last_touch_at: daysAgo(1) },
      { id: 'm4', company: 'Old', stage: 'Nurture', stage_since: daysAgo(90) },
    ]
    const tasks = [{ contact_id: 'm1', business_id: 'mpg', due_at: new Date(NOW).toISOString() }]
    const r = merchantsInFlight({ mpgRows, tasks, approvedThisMonth: 1, now: NOW })
    expect(r.counts).toEqual({ Open: 1, Submitted: 1, Approved: 1, approvedThisMonth: 1 })
    expect(r.rows.map((x) => [x.name, x.flag.text])).toEqual([
      ['Harbor Grill', 'Follow-up due today'],
      ['Ace Auto', 'No touch in 10 days'],
      ['Lone Star', 'On track'],
    ])
  })
})

describe('book health', () => {
  const pipeline = [
    { id: 1, stage: 'Application Received', last_touch_at: daysAgo(6) },
    { id: 2, stage: 'Application Received', last_touch_at: daysAgo(1) },
    { id: 3, stage: 'Disclosed', docs_outstanding_count: 1, docs_oldest_requested_at: daysAgo(8) },
  ]
  const tasks = [
    { business_id: 'bay', due_at: daysAgo(2) },
    { business_id: 'mpg', due_at: daysAgo(1) },
    { business_id: 'bay', due_at: new Date(NOW).toISOString() },
  ]
  const partners = [{ last_touch_at: daysAgo(45) }, { last_touch_at: daysAgo(3) }, { last_touch_at: null }]

  it('counts problems across both books and hides zero rows', () => {
    const rows = bookHealth({ biz: 'all', pipeline, tasks, partners, now: NOW })
    expect(rows.map((r) => [r.id, r.count])).toEqual([
      ['apps_quiet', 1],
      ['docs_aging', 1],
      ['overdue', 2],
      ['partners_quiet', 2],
    ])
  })

  it('follows the book switch', () => {
    expect(bookHealth({ biz: 'mpg', pipeline, tasks, partners, now: NOW }).map((r) => [r.id, r.count])).toEqual([['overdue', 1]])
    expect(bookHealth({ biz: 'bay', now: NOW })).toEqual([])
  })
})

describe('shortDay', () => {
  it('names nearby days and dates further out', () => {
    expect(shortDay('2026-11-23', NOW)).toBe('today')
    expect(shortDay('2026-11-24', NOW)).toBe('tomorrow')
    expect(shortDay('2026-11-26', NOW)).toBe('Thu')
    expect(shortDay('2026-12-04', NOW)).toBe('Dec 4')
  })
})

describe('hardDateTask', () => {
  it("words a hard date as the assistant's task", () => {
    expect(hardDateTask({ kind: 'cd', on: '2026-11-24', days: 1 }, NOW)).toBe('prepare the closing disclosure packet')
    expect(hardDateTask({ kind: 'cd', on: '2026-11-20', days: -3 }, NOW)).toBe('the closing disclosure is overdue (was due Nov 20): get the packet out')
    expect(hardDateTask({ kind: 'lock', on: '2026-12-02', days: 9 }, NOW)).toBe('rate lock ends: confirm the closing date with title')
    expect(hardDateTask({ kind: 'lock', on: '2026-11-21', days: -2 }, NOW)).toBe('the rate lock expired Nov 21: tell Chandler')
  })
})
