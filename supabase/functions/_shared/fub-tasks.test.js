import { describe, it, expect } from 'vitest'
import { mapTask, taskDueAt, taskTitle, taskIsCompleted, reconcileCompleted } from './fub-tasks.ts'

describe('taskDueAt', () => {
  it('prefers dueDate then due then dueAt', () => {
    expect(taskDueAt({ dueDate: '2026-07-20T15:00:00Z', due: 'x' })).toBe('2026-07-20T15:00:00Z')
    expect(taskDueAt({ due: '2026-07-21T15:00:00Z' })).toBe('2026-07-21T15:00:00Z')
    expect(taskDueAt({ dueAt: '2026-07-22T15:00:00Z' })).toBe('2026-07-22T15:00:00Z')
  })
  it('returns null when no due field is present', () => {
    expect(taskDueAt({})).toBe(null)
  })
})

describe('taskTitle', () => {
  it('prefers name, then subject, then description', () => {
    expect(taskTitle({ name: 'Call Marcus', description: 'x' })).toBe('Call Marcus')
    expect(taskTitle({ subject: 'Send docs' })).toBe('Send docs')
    expect(taskTitle({ description: 'Follow up' })).toBe('Follow up')
    expect(taskTitle({})).toBe('Task')
  })
})

describe('taskIsCompleted', () => {
  it('reads isCompleted, then completed', () => {
    expect(taskIsCompleted({ isCompleted: true })).toBe(true)
    expect(taskIsCompleted({ completed: true })).toBe(true)
    expect(taskIsCompleted({ isCompleted: false })).toBe(false)
  })
  it('defaults to false when neither field is present', () => {
    expect(taskIsCompleted({})).toBe(false)
  })
})

describe('mapTask', () => {
  const contacts = new Map([['501', 'uuid-contact']])
  const deals = new Map([['900', 'uuid-deal']])

  it('maps a full FUB task onto a tasks row', () => {
    const row = mapTask(
      {
        id: 77,
        name: 'Call Marcus re: rate lock',
        type: 'Call',
        dueDate: '2026-07-20T15:00:00Z',
        priority: 'High',
        assignedTo: 'Chandler Atkinson',
        isCompleted: false,
        personId: 501,
        dealId: 900,
      },
      contacts,
      deals,
    )
    expect(row).toMatchObject({
      business_id: 'bay',
      source_crm: 'fub',
      external_id: '77',
      title: 'Call Marcus re: rate lock',
      task_type: 'Call',
      due_at: '2026-07-20T15:00:00Z',
      priority: 'High',
      owner: 'Chandler Atkinson',
      is_completed: false,
      contact_id: 'uuid-contact',
      deal_id: 'uuid-deal',
    })
    expect(row.raw.id).toBe(77)
    expect(typeof row.updated_at).toBe('string')
  })

  it('leaves contact_id and deal_id null when the ids are unknown', () => {
    const row = mapTask({ id: 78, personId: 999, dealId: 999 }, contacts, deals)
    expect(row.contact_id).toBe(null)
    expect(row.deal_id).toBe(null)
  })

  it('resolves a nested person object and falls back on assignedUserName', () => {
    const row = mapTask(
      { id: 79, person: { id: 501 }, assignedUserName: 'Chandler A.' },
      contacts,
      deals,
    )
    expect(row.contact_id).toBe('uuid-contact')
    expect(row.owner).toBe('Chandler A.')
  })

  it('nulls priority when absent (FUB often has none)', () => {
    expect(mapTask({ id: 80 }, contacts, deals).priority).toBe(null)
  })
})

describe('reconcileCompleted', () => {
  it('returns ids of our rows no longer open in FUB', () => {
    const open = new Set(['77', '78'])
    const rows = [
      { id: 'u1', external_id: '77' }, // still open
      { id: 'u2', external_id: '79' }, // completed in FUB
    ]
    expect(reconcileCompleted(open, rows)).toEqual(['u2'])
  })

  it('returns empty when every row is still open', () => {
    const open = new Set(['77', '78'])
    expect(reconcileCompleted(open, [{ id: 'u1', external_id: '77' }])).toEqual([])
  })

  it('marks all rows when the open set is empty (everything done)', () => {
    const rows = [
      { id: 'u1', external_id: '77' },
      { id: 'u2', external_id: '78' },
    ]
    expect(reconcileCompleted(new Set(), rows)).toEqual(['u1', 'u2'])
  })

  it('returns empty for no rows', () => {
    expect(reconcileCompleted(new Set(['77']), [])).toEqual([])
  })

  it('compares external_id as a string on both sides', () => {
    expect(reconcileCompleted(new Set(['77']), [{ id: 'u1', external_id: 77 }])).toEqual([])
  })
})
