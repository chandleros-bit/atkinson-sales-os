import { describe, it, expect } from 'vitest'
import { buildAlerts, QUIET_APP_DAYS } from './alerts'
import { DEFAULT_RULES } from './priorityQueue'

// Local times (no Z), as in cardHealth.test.js. 2026-10-18 is a Sunday.
const NOW = new Date('2026-10-18T09:00:00').getTime()
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString()
const rules = DEFAULT_RULES
const ids = (a) => a.people.map((p) => p.id)
const byId = (list, id) => list.find((a) => a.id === id)

describe('buildAlerts', () => {
  it('nothing to say, no alerts', () => {
    expect(buildAlerts({ rules, now: NOW })).toEqual([])
  })

  it('counts new leads past speed-to-lead, not the fresh or called ones', () => {
    const queue = [
      { id: 'a', business_id: 'bay', name: 'Ana', stage: 'New Lead', crm_created_at: minsAgo(20) },
      { id: 'b', business_id: 'mpg', name: 'Bo', stage: 'Not Contacted', crm_created_at: minsAgo(40) },
      { id: 'c', business_id: 'bay', name: 'Cy', stage: 'New Lead', crm_created_at: minsAgo(2) },
      { id: 'd', business_id: 'bay', name: 'Di', stage: 'New Lead', crm_created_at: minsAgo(60), last_outbound_call_at: minsAgo(30) },
    ]
    const a = byId(buildAlerts({ queue, rules, now: NOW }), 'new_leads')
    expect(a).toMatchObject({ tone: 'neg', count: 2, hint: 'Past 5m, not called' })
    expect(a.people).toEqual([
      { id: 'a', name: 'Ana', book: 'bay' },
      { id: 'b', name: 'Bo', book: 'mpg' },
    ])
  })

  it('applications gone quiet use the human touch, not the CRM date', () => {
    const app = (id, o) => ({ id, business_id: 'bay', name: id, stage: 'Application Received', ...o })
    const signals = [
      app('quiet', { last_outbound_at: daysAgo(QUIET_APP_DAYS), last_touch_at: daysAgo(0) }),
      app('never', {}),
      app('fresh', { last_inbound_at: daysAgo(1) }),
      { ...app('other', {}), stage: 'Attempted' },
    ]
    expect(ids(byId(buildAlerts({ signals, rules, now: NOW }), 'quiet_apps'))).toEqual(['quiet', 'never'])
  })

  it('docs aging only on applications with old, outstanding requests', () => {
    const pipeline = [
      { id: 'old', name: 'Old', stage: 'Application Received', docs_outstanding_count: 2, docs_oldest_requested_at: daysAgo(9) },
      { id: 'new', name: 'New', stage: 'Application Received', docs_outstanding_count: 1, docs_oldest_requested_at: daysAgo(1) },
      { id: 'none', name: 'None', stage: 'Application Received', docs_outstanding_count: 0, docs_oldest_requested_at: daysAgo(20) },
      { id: 'est', name: 'Est', stage: 'Contacted/Working', docs_outstanding_count: 3, docs_oldest_requested_at: daysAgo(20) },
    ]
    expect(ids(byId(buildAlerts({ pipeline, rules, now: NOW }), 'docs_aging'))).toEqual(['old'])
  })

  it('statement tasks overdue name the merchant', () => {
    const tasks = [
      { id: 1, title: 'Follow up on statements', due_at: daysAgo(2), contact_id: 'm1', company: 'Pita Co' },
      { id: 2, title: 'Send proposal', due_at: daysAgo(0), contact_id: 'm2', company: 'Today Inc' },
      { id: 3, title: 'Call back', due_at: daysAgo(5), contact_id: 'm3', company: 'Other' },
    ]
    const a = byId(buildAlerts({ tasks, rules, now: NOW }), 'statements_late')
    expect(a.people).toEqual([{ id: 'm1', name: 'Pita Co', book: 'mpg' }])
  })

  it('check-backs due today or earlier, waiting only', () => {
    const day = (n) => daysAgo(n).slice(0, 10)
    const workItems = [
      { id: 1, business_id: 'bay', status: 'waiting', check_back_on: day(0), contact_id: 'x', contact_name: 'Xen' },
      { id: 2, business_id: 'mpg', status: 'waiting', check_back_on: day(-2), contact_id: 'y', contact_name: 'Yan' },
      { id: 3, business_id: 'bay', status: 'open', check_back_on: day(3), contact_id: 'z', contact_name: 'Zed' },
    ]
    expect(ids(byId(buildAlerts({ workItems, rules, now: NOW }), 'check_backs'))).toEqual(['x'])
  })

  it('follows the business filter and shows three names plus a count', () => {
    const pipeline = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, stage: 'Application Received', docs_outstanding_count: 1, docs_oldest_requested_at: daysAgo(10) }))
    const tasks = [{ id: 1, title: 'Statements', due_at: daysAgo(3), contact_id: 'm', company: 'M' }]
    const all = buildAlerts({ pipeline, tasks, rules, now: NOW })
    expect(byId(all, 'docs_aging')).toMatchObject({ count: 5, more: 2 })
    expect(byId(all, 'docs_aging').people).toHaveLength(3)
    const mpgOnly = buildAlerts({ pipeline, tasks, rules, now: NOW, inBook: (b) => b === 'mpg' })
    expect(mpgOnly.map((a) => a.id)).toEqual(['statements_late'])
  })

  it('red alerts come first', () => {
    const pipeline = [{ id: 'd', name: 'd', stage: 'Application Received', docs_outstanding_count: 1, docs_oldest_requested_at: daysAgo(10) }]
    const signals = [{ id: 'q', business_id: 'bay', name: 'q', stage: 'Application Received' }]
    expect(buildAlerts({ pipeline, signals, rules, now: NOW }).map((a) => a.id)).toEqual(['quiet_apps', 'docs_aging'])
  })
})
