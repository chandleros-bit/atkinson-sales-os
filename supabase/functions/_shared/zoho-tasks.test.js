import { describe, it, expect } from 'vitest'
import { mapTask, zohoTaskIsCompleted } from './zoho-tasks.ts'

describe('zohoTaskIsCompleted', () => {
  it('is true for the stock Completed status, case-insensitively', () => {
    expect(zohoTaskIsCompleted({ Status: 'Completed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: 'completed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: ' Completed ' })).toBe(true)
  })
  it('also accepts common renames of the done state', () => {
    expect(zohoTaskIsCompleted({ Status: 'Closed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: 'Done' })).toBe(true)
  })
  it('is false for every open state', () => {
    expect(zohoTaskIsCompleted({ Status: 'Not Started' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'In Progress' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'Deferred' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'Waiting on someone else' })).toBe(false)
  })
  it('defaults to false with no Status', () => {
    expect(zohoTaskIsCompleted({})).toBe(false)
  })
})

describe('mapTask', () => {
  const contacts = new Map([['zc1', 'uuid-contact']])
  const deals = new Map([['zd1', 'uuid-deal']])

  it('maps a full Zoho task onto a tasks row', () => {
    const row = mapTask(
      {
        id: '4400001',
        Subject: 'Send MPG proposal',
        Task_Type: 'Email',
        Due_Date: '2026-07-21',
        Priority: 'High',
        Status: 'Not Started',
        Owner: { name: 'Chandler Atkinson' },
        Who_Id: { id: 'zc1' },
        What_Id: { id: 'zd1' },
        '$se_module': 'Deals',
      },
      contacts,
      deals,
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: '4400001',
      title: 'Send MPG proposal',
      task_type: 'Email',
      due_at: '2026-07-21',
      priority: 'High',
      owner: 'Chandler Atkinson',
      is_completed: false,
      contact_id: 'uuid-contact',
      deal_id: 'uuid-deal',
    })
    expect(row.raw.id).toBe('4400001')
  })

  it('ignores What_Id when it does not point at a Deal', () => {
    const row = mapTask(
      { id: '2', What_Id: { id: 'zd1' }, '$se_module': 'Accounts' },
      contacts,
      deals,
    )
    expect(row.deal_id).toBe(null)
  })

  it('resolves a deal when $se_module is absent but the id is a known deal', () => {
    const row = mapTask({ id: '3', What_Id: { id: 'zd1' } }, contacts, deals)
    expect(row.deal_id).toBe('uuid-deal')
  })

  it('marks a Completed task so v_tasks drops it', () => {
    expect(mapTask({ id: '4', Status: 'Completed' }, contacts, deals).is_completed).toBe(true)
  })

  it('falls back to a placeholder title and null links', () => {
    const row = mapTask({ id: '5' }, contacts, deals)
    expect(row.title).toBe('Task')
    expect(row.contact_id).toBe(null)
    expect(row.deal_id).toBe(null)
    expect(row.due_at).toBe(null)
    expect(row.owner).toBe(null)
    expect(typeof row.updated_at).toBe('string')
  })

  it('falls back to Owner.full_name when name is absent', () => {
    const row = mapTask({ id: '6', Owner: { full_name: 'Chandler Atkinson' } }, contacts, deals)
    expect(row.owner).toBe('Chandler Atkinson')
  })

  it('tolerates a Who_Id with no id', () => {
    expect(mapTask({ id: '7', Who_Id: {} }, contacts, deals).contact_id).toBe(null)
  })
})
