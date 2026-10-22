import { describe, it, expect } from 'vitest'
import { buildWorkGroups, workProgress } from './workbench'
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
const build = (pipeline = [], mpgTasks = [], workItems = []) => buildWorkGroups({ pipeline, mpgTasks, workItems, rules: DEFAULT_RULES, now: NOW })
const dayOnly = (n) => daysAgo(n).slice(0, 10)
const byId = (groups, id) => groups.find((g) => g.id === id)

describe('buildWorkGroups', () => {
  it('always returns the five groups in order', () => {
    expect(build().map((g) => [g.id, g.title, g.book, g.items.length])).toEqual([
      ['estimates', 'Estimates to Work', 'bay', 0],
      ['applications', 'Applications to Review', 'bay', 0],
      ['statements', 'Statement/Proposal Review', 'mpg', 0],
      ['custom', 'Other work', null, 0],
      ['waiting', 'Waiting on others', null, 0],
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

  it('carries a work item row onto its generated item', () => {
    const [est] = build([lead({ id: 'a', stage_since: daysAgo(2) })], [], [
      { id: 'w1', source_key: 'estimate:a', kind: 'estimate', status: 'working', notes: 'Rate sheet asked', updated_at: daysAgo(0) },
    ])
    expect(est.items[0]).toMatchObject({ key: 'estimate:a', book: 'bay', rowId: 'w1', status: 'working', notes: 'Rate sheet asked' })
  })

  it('hides a done estimate until the lead re-enters the stage', () => {
    const done = (at) => [{ id: 'w', source_key: 'estimate:a', kind: 'estimate', status: 'done', done_at: at }]
    expect(build([lead({ id: 'a', stage_since: daysAgo(3) })], [], done(daysAgo(1)))[0].items).toEqual([])
    const back = build([lead({ id: 'a', stage_since: daysAgo(1) })], [], done(daysAgo(3)))[0].items
    expect(back.map((i) => [i.key, i.status])).toEqual([['estimate:a', 'open']])
  })

  it('hides a reviewed application for 7 days (the weekly review)', () => {
    const app = [lead({ id: 'p', stage: 'Application Received', stage_since: daysAgo(30) })]
    const reviewed = (n) => [{ id: 'w', source_key: 'application:p', kind: 'application', status: 'done', done_at: daysAgo(n) }]
    expect(build(app, [], reviewed(6))[1].items).toEqual([])
    expect(build(app, [], reviewed(7))[1].items.map((i) => i.status)).toEqual(['open'])
  })

  it('parks waiting items until their check-back day, then brings them back', () => {
    const groups = build([lead({ id: 'a' }), lead({ id: 'b' }), lead({ id: 'c' })], [], [
      { id: 'w1', source_key: 'estimate:a', kind: 'estimate', status: 'waiting', waiting_on: 'Lender', check_back_on: dayOnly(-2) },
      { id: 'w2', source_key: 'estimate:b', kind: 'estimate', status: 'waiting', waiting_on: 'Borrower', check_back_on: dayOnly(0) },
      { id: 'w3', source_key: 'estimate:c', kind: 'estimate', status: 'waiting', waiting_on: 'Processor', check_back_on: dayOnly(3) },
    ])
    expect(byId(groups, 'waiting').items.map((i) => [i.key, i.why])).toEqual([['estimate:a', 'Waiting on Lender · check back Sat · Oct 24']])
    expect(byId(groups, 'estimates').items.map((i) => [i.key, i.why, i.late])).toEqual([
      ['estimate:c', 'Check back 3 days late · Processor', true],
      ['estimate:b', 'Check back today · Borrower', false],
    ])
  })

  it('lists open custom items in Other work with their own book', () => {
    const groups = build([], [], [
      { id: 'c1', kind: 'custom', business_id: 'mpg', title: 'Send ISO agreement', status: 'open', created_at: daysAgo(2) },
      { id: 'c2', kind: 'custom', business_id: 'bay', title: 'Fix appraisal', status: 'working', contact_id: 'x', created_at: daysAgo(0) },
      { id: 'c3', kind: 'custom', business_id: 'bay', title: 'Old', status: 'done', done_at: daysAgo(0), created_at: daysAgo(5) },
    ])
    expect(byId(groups, 'custom').items.map((i) => [i.key, i.kind, i.book, i.title, i.why, i.status, i.contactId])).toEqual([
      ['custom:c1', 'custom', 'mpg', 'Send ISO agreement', 'Added 2 days ago', 'open', null],
      ['custom:c2', 'custom', 'bay', 'Fix appraisal', 'Added today', 'working', 'x'],
    ])
  })
})

describe('workProgress', () => {
  it('counts rows done today against open plus done today', () => {
    const rows = [
      { status: 'done', done_at: daysAgo(0, '08:00:00') },
      { status: 'done', done_at: daysAgo(1) },
      { status: 'working' },
    ]
    expect(workProgress(rows, 4, NOW)).toEqual({ done: 1, total: 5 })
  })
})
