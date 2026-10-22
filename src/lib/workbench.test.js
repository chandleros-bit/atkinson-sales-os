import { describe, it, expect } from 'vitest'
import { buildWorkGroups } from './workbench'
import { DEFAULT_RULES } from './priorityQueue'

// Local times (no Z), as the other day-math tests. 2026-10-22 is a Thursday.
const NOW = new Date('2026-10-22T10:00:00').getTime()
const daysAgo = (n, hh = '10:00:00') => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  const p = (x) => String(x).padStart(2, '0')
  return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hh}`).toISOString()
}
const lead = (o) => ({ id: o.id, name: o.name || o.id, stage: 'Contacted/Working', stage_since: null, open_task_count: 0, oldest_open_due_at: null, docs_outstanding_count: 0, ...o })
const build = (pipeline = [], mpgTasks = []) => buildWorkGroups({ pipeline, mpgTasks, rules: DEFAULT_RULES, now: NOW })

describe('buildWorkGroups', () => {
  it('always returns the three groups in order', () => {
    expect(build().map((g) => [g.id, g.title, g.book, g.items.length])).toEqual([
      ['estimates', 'Estimates to Work', 'bay', 0],
      ['applications', 'Applications to Review', 'bay', 0],
      ['statements', 'Statement/Proposal Review', 'mpg', 0],
    ])
  })

  it('lists Contacted/Working leads as estimates, oldest first, late past the stage limit', () => {
    const [est] = build([
      lead({ id: 'new', stage_since: daysAgo(1) }),
      lead({ id: 'old', stage_since: daysAgo(8) }),
      lead({ id: 'unknown' }),
      lead({ id: 'app', stage: 'Application Received' }),
    ])
    expect(est.items.map((i) => [i.contactId, i.title, i.why, i.late])).toEqual([
      ['old', 'Work estimate', 'Working 8 days', true],
      ['new', 'Work estimate', 'Working 1 day', false],
      ['unknown', 'Work estimate', 'In Contacted/Working', false],
    ])
    expect(est.items[0]).toMatchObject({ kind: 'estimate', key: 'estimate:old' })
  })

  it('says when an estimate lead has a follow-up overdue', () => {
    const [est] = build([lead({ id: 'a', stage_since: daysAgo(2), open_task_count: 1, oldest_open_due_at: daysAgo(3) })])
    expect(est.items[0]).toMatchObject({ why: 'Follow-up 3 days overdue', late: true })
  })

  it('lists Application Received files, missing docs first', () => {
    const [, apps] = build([
      lead({ id: 'quiet', stage: 'Application Received', stage_since: daysAgo(3) }),
      lead({ id: 'docs', stage: 'Application Received', stage_since: daysAgo(1), docs_outstanding_count: 2 }),
      lead({ id: 'stale', stage: 'Application Received', stage_since: daysAgo(20) }),
    ])
    expect(apps.items.map((i) => [i.contactId, i.title, i.why, i.late])).toEqual([
      ['docs', 'Review application', '2 docs missing', true],
      ['stale', 'Review application', 'In Application Received 20 days', true],
      ['quiet', 'Review application', 'In Application Received 3 days', false],
    ])
  })

  it('turns open MPG Zoho tasks into statement/proposal work, earliest due first', () => {
    const [, , mpg] = build([], [
      { id: 't2', title: 'Proposal review', due_at: daysAgo(-2), contact_id: 'm2', contact_name: 'Ana', company: 'Deli' },
      { id: 't1', title: '3 Statements FU', due_at: daysAgo(5), contact_id: 'm1', contact_name: 'David', company: 'Lending Flow' },
    ])
    expect(mpg.items.map((i) => [i.taskId, i.contactId, i.title, i.name, i.late])).toEqual([
      ['t1', 'm1', '3 Statements FU', 'Lending Flow · David', true],
      ['t2', 'm2', 'Proposal review', 'Deli · Ana', false],
    ])
    expect(mpg.items[0]).toMatchObject({ kind: 'mpg_task', why: 'Due 5 days ago' })
  })
})
