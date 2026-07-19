import { describe, it, expect } from 'vitest'
import { mapTask, zohoTaskIsCompleted } from './zoho-tasks.ts'

describe('zohoTaskIsCompleted', () => {
  it('is true only for the Completed status', () => {
    expect(zohoTaskIsCompleted({ Status: 'Completed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: 'completed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: 'Not Started' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'In Progress' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'Deferred' })).toBe(false)
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
  })
})
