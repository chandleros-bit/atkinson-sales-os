import { describe, it, expect } from 'vitest'
import { buildAssistantBriefing, CHASE_DAYS } from './assistantBriefing'

// Wed Nov 4 2026, 7:30 AM Chicago (CST, UTC-6).
const NOW = Date.parse('2026-11-04T13:30:00Z')
const iso = (s) => new Date(s).toISOString()

const pipe = (o) => ({ id: o.id, name: o.name, stage: 'Contacted/Working', stage_since: null, docs_tracked: false, docs_outstanding: [], docs_outstanding_count: 0, docs_oldest_requested_at: null, ...o })

describe('buildAssistantBriefing', () => {
  it('lists open loans closing in the next 7 days with docs, title and agents', () => {
    const m = buildAssistantBriefing({
      loans: [
        { id: 'l1', contact_id: 'c1', borrower_name: 'Pat Lee', stage_group: 'closing', firm_closing_on: '2026-11-06', title_company: 'Lone Star Title', buyer_agent_name: 'Jo Ray', buyer_agent_phone: '7135550100', seller_agent_name: null, seller_agent_phone: null },
        { id: 'l2', contact_id: 'c2', borrower_name: 'Funded Fay', stage_group: 'funded', firm_closing_on: '2026-11-05' },
        { id: 'l3', contact_id: 'c3', borrower_name: 'Late Lou', stage_group: 'closing', firm_closing_on: '2026-11-12' },
        { id: 'l4', contact_id: 'c4', borrower_name: 'Scenario Sam', stage_group: 'closing', firm_closing_on: '2026-11-05', scenario_override: true },
      ],
      pipeline: [pipe({ id: 'c1', name: 'Pat Lee', docs_tracked: true, docs_outstanding: ['W2'], docs_outstanding_count: 1, docs_oldest_requested_at: iso('2026-11-01T15:00:00Z') })],
      workItems: [],
    }, NOW)
    expect(m.closing.count).toBe(1)
    expect(m.closing.top[0]).toEqual({ name: 'Pat Lee', date: '2026-11-06', title: 'Lone Star Title', docs: ['W2'], buyerAgent: { name: 'Jo Ray', phone: '7135550100' }, sellerAgent: null })
    expect(m.closingCount).toBe(1)
  })

  it('puts Application Received leads under Disclosures due with a 3-business-day deadline', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'Due Dan', stage: 'Application Received', stage_since: iso('2026-10-30T16:00:00Z') }), // Fri -> Wed Nov 4: due today
        pipe({ id: 'b', name: 'Fresh Fran', stage: 'Application Received', stage_since: iso('2026-11-03T16:00:00Z') }), // Tue -> Fri Nov 6
        pipe({ id: 'c', name: 'Disclosed Di', stage: 'Disclosed', stage_since: iso('2026-10-20T16:00:00Z') }),
      ],
      workItems: [],
    }, NOW)
    expect(m.disclosures.top).toEqual([
      { name: 'Due Dan', dueBy: '2026-11-04', due: true },
      { name: 'Fresh Fran', dueBy: '2026-11-06', due: false },
    ])
  })

  it('orders missing docs oldest first and marks 7+ days as chase today', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'New Ned', docs_tracked: true, docs_outstanding: ['Paystub'], docs_outstanding_count: 1, docs_oldest_requested_at: iso('2026-11-02T13:00:00Z') }),
        pipe({ id: 'b', name: 'Old Olga', docs_tracked: true, docs_outstanding: ['W2', 'Bank'], docs_outstanding_count: 2, docs_oldest_requested_at: iso('2026-10-25T13:00:00Z') }),
        pipe({ id: 'c', name: 'Clear Cy', docs_tracked: true, docs_outstanding: [], docs_outstanding_count: 0 }),
      ],
      workItems: [],
    }, NOW)
    expect(m.missingDocs.count).toBe(2)
    expect(m.missingDocs.top[0]).toEqual({ name: 'Old Olga', docs: ['W2', 'Bank'], days: 10, chase: true })
    expect(m.missingDocs.top[1].chase).toBe(false)
    expect(m.chaseCount).toBe(1)
    expect(CHASE_DAYS).toBe(7)
  })

  it('lists applications received on the previous business day', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'Yesterday Yu', stage: 'Application Received', stage_since: iso('2026-11-03T20:00:00Z') }),
        pipe({ id: 'b', name: 'Today Tia', stage: 'Application Received', stage_since: iso('2026-11-04T13:00:00Z') }),
      ],
      workItems: [],
    }, NOW)
    expect(m.newApps.top).toEqual([{ name: 'Yesterday Yu' }])
  })

  it('waits on borrowers: Application/Estimate Sent 3+ days, and due check-backs', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'Slow Sue', stage: 'Application/Estimate Sent', stage_since: iso('2026-10-30T13:00:00Z') }),
        pipe({ id: 'b', name: 'Quick Quin', stage: 'Application/Estimate Sent', stage_since: iso('2026-11-03T13:00:00Z') }),
      ],
      workItems: [
        { id: 'w1', kind: 'custom', title: 'Call title about payoff', status: 'waiting', check_back_on: '2026-11-04', due_on: null, contact_name: 'Pat Lee' },
        { id: 'w2', kind: 'custom', title: 'Later', status: 'open', check_back_on: '2026-11-09', due_on: null, contact_name: null },
      ],
    }, NOW)
    expect(m.waiting.top).toEqual([
      { name: 'Slow Sue', detail: 'Application/Estimate Sent 5 days ago, no movement' },
      { name: 'Pat Lee', detail: 'Check back: Call title about payoff' },
    ])
  })

  it('is quiet when every list is empty', () => {
    const m = buildAssistantBriefing({ loans: [], pipeline: [], workItems: [] }, NOW)
    expect(m.quiet).toBe(true)
    expect(m.dateLabel).toBe('Wed Nov 4')
  })
})
