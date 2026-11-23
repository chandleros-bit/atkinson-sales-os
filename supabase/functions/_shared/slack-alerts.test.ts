import { describe, it, expect } from 'vitest'
import { buildAlerts, planMessages, inSendWindow, type Inputs, type SignalRow } from './slack-alerts.ts'

const NOW = new Date('2026-11-19T16:00:00Z').getTime() // Thu 10 AM Central
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const link = (p: string) => `https://app.test${p}`

function run(over: Partial<Inputs> = {}) {
  return buildAlerts({ signals: [], pipeline: [], loans: [], syncs: [], hotColdDays: 3, useCrmActivity: true, link, now: NOW, ...over })
}
const sig = (over: Partial<SignalRow>): SignalRow => ({ id: 'c1', business_id: 'bay', name: 'Maria Lopez', stage: 'Attempted', ...over })

describe('slack alert rules', () => {
  it('pushes a new, uncalled lead once, with a link to the contact card', () => {
    const a = run({ signals: [sig({ stage: 'New Lead', crm_created_at: hoursAgo(1) })] })
    expect(a.map((x) => x.kind)).toEqual(['new_lead'])
    expect(a[0].key).toBe('new_lead:c1')
    expect(a[0].text).toContain('<https://app.test/workbench?person=c1|Maria Lopez>')
    expect(run({ signals: [sig({ stage: 'New Lead', crm_created_at: hoursAgo(1), last_outbound_call_at: hoursAgo(0.5) })] })).toEqual([])
    expect(run({ signals: [sig({ stage: 'New Lead', crm_created_at: hoursAgo(30) })] })).toEqual([])
  })

  it('pushes an inbound we have not answered, keyed by that inbound', () => {
    const a = run({ signals: [sig({ last_inbound_at: hoursAgo(2), last_outbound_at: hoursAgo(5), is_partner: true })] })
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('reached_out')
    expect(a[0].key).toBe(`reached_out:c1:${hoursAgo(2)}`)
    expect(a[0].text).toContain('(partner)')
    expect(run({ signals: [sig({ last_inbound_at: hoursAgo(2), last_outbound_at: hoursAgo(1) })] })).toEqual([])
  })

  it('flags a hot lead with no touch in 3 days; the rating overrides the FUB flag', () => {
    const quiet = { last_outbound_at: hoursAgo(80), crm_last_activity_at: hoursAgo(90) }
    expect(run({ signals: [sig({ is_hot: true, ...quiet })] }).map((x) => x.kind)).toEqual(['hot_cold'])
    expect(run({ signals: [sig({ is_hot: true, temperature: 'warm', ...quiet })] })).toEqual([])
    expect(run({ signals: [sig({ temperature: 'hot', last_outbound_at: hoursAgo(10) })] })).toEqual([])
  })

  it('skips lost and nurture leads', () => {
    expect(run({ signals: [sig({ stage: 'Nurture / Credit Repair', is_hot: true })] })).toEqual([])
    expect(run({ signals: [sig({ stage: 'Lost', last_inbound_at: hoursAgo(1) })] })).toEqual([])
  })

  it('flags aging docs and quiet applications', () => {
    const a = run({ pipeline: [{ id: 'p1', name: 'Ann', stage: 'Application Received', last_touch_at: hoursAgo(24 * 6), docs_outstanding_count: 2, docs_oldest_requested_at: hoursAgo(24 * 8) }] })
    expect(a.map((x) => x.kind)).toEqual(['docs_aging', 'quiet_app'])
    expect(a[0].text).toContain('2 docs')
  })

  it('flags unfunded closings in the next 3 days only', () => {
    const a = run({ loans: [
      { id: 'l1', borrower_name: 'Bo', firm_closing_on: '2026-11-19' },
      { id: 'l2', borrower_name: 'Cy', firm_closing_on: '2026-11-22' },
      { id: 'l3', borrower_name: 'Di', firm_closing_on: '2026-11-25' },
      { id: 'l4', borrower_name: 'Ed', firm_closing_on: '2026-11-20', funded_on: '2026-11-18' },
    ] })
    expect(a.map((x) => x.key)).toEqual(['closing:l1:2026-11-19', 'closing:l2:2026-11-22'])
    expect(a[0].text).toContain('Closing today')
  })

  it('flags a failed sync at most once an hour, in its book', () => {
    const a = run({ syncs: [
      { source: 'zoho', status: 'error', ran_at: hoursAgo(0.1), message: 'token expired' },
      { source: 'fub', status: 'ok', ran_at: hoursAgo(0.1) },
      { source: 'pmms-refresh', status: 'error', ran_at: hoursAgo(0.1) },
    ] })
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ kind: 'sync_fail', book: 'mpg', key: 'sync_fail:zoho:2026-11-19T15' })
  })
})

describe('planMessages', () => {
  it('sends one message per book, most urgent first, capped, skipping sent keys', () => {
    const alerts = [
      { key: 'a', kind: 'hot_cold', book: 'bay' as const, text: 'hot' },
      { key: 'b', kind: 'new_lead', book: 'bay' as const, text: 'new' },
      { key: 'c', kind: 'reached_out', book: 'mpg' as const, text: 'call back' },
      { key: 'd', kind: 'quiet_app', book: 'bay' as const, text: 'quiet' },
    ]
    const m = planMessages(alerts, new Set(['d']), link, 1)
    expect(m).toHaveLength(2)
    const bay = m.find((x) => x.book === 'bay')!
    expect(bay.text.split('\n')[0]).toBe('new')
    expect(bay.text).toContain('…and 1 more')
    expect(bay.keys.sort()).toEqual(['a', 'b'])
    expect(planMessages(alerts, new Set(['a', 'b', 'c', 'd']), link)).toEqual([])
  })

  it('sends only 7 AM to 9 PM Central', () => {
    expect(inSendWindow(new Date('2026-11-19T13:00:00Z').getTime())).toBe(true) // 7 AM
    expect(inSendWindow(new Date('2026-11-19T12:59:00Z').getTime())).toBe(false)
    expect(inSendWindow(new Date('2026-11-20T03:00:00Z').getTime())).toBe(false) // 9 PM
  })
})

describe('rate lock alerts', () => {
  it('flags locks expiring within 3 days or expired without funding, and a closing after the lock', () => {
    const a = run({ loans: [
      { id: 'l1', borrower_name: 'Bo', lock_expires_on: '2026-11-21', firm_closing_on: '2026-11-25', stage_group: 'closing' },
      { id: 'l2', borrower_name: 'Cy', lock_expires_on: '2026-11-10', stage_group: 'processing' },
      { id: 'l3', borrower_name: 'Di', lock_expires_on: '2026-11-30', stage_group: 'processing' },
      { id: 'l4', borrower_name: 'Ed', lock_expires_on: '2026-11-20', stage_group: 'funded' },
      { id: 'l5', borrower_name: 'Fy', lock_expires_on: '2026-11-20', stage_group: 'processing', scenario: true },
    ] })
    expect(a.map((x) => x.key)).toEqual(['lock:l1:2026-11-21', 'lock:l2:2026-11-10'])
    expect(a[0].text).toContain('Closing (2026-11-25) is after the lock')
    expect(a[1].text).toContain('expired 2026-11-10')
  })
})

describe('drafts waiting', () => {
  it('pushes once a day after 11 AM Central when drafts wait', () => {
    const at11 = new Date('2026-11-19T17:05:00Z').getTime() // 11:05 AM Central
    const a = buildAlerts({ signals: [], pipeline: [], loans: [], syncs: [], hotColdDays: 3, useCrmActivity: true, link, now: at11, draftsWaiting: 3 })
    expect(a).toEqual([{ key: 'drafts:2026-11-19', kind: 'drafts', book: 'bay', text: ':memo: 3 drafts waiting in <https://app.test/bayway/drafts|Drafts>.' }])
    expect(run({ draftsWaiting: 3 })).toEqual([]) // 10 AM: still calls
    expect(buildAlerts({ signals: [], pipeline: [], loans: [], syncs: [], hotColdDays: 3, useCrmActivity: true, link, now: at11, draftsWaiting: 0 })).toEqual([])
  })
})
