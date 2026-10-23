import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
vi.mock('./supabase', () => ({
  supabase: {
    from: (table) => {
      const q = {}
      for (const op of ['insert', 'upsert', 'update']) {
        q[op] = (body, opts) => {
          calls.push({ table, op, body, opts })
          return q
        }
      }
      q.eq = (c, v) => {
        calls.at(-1).eq = [c, v]
        return q
      }
      return q
    },
  },
}))

const { saveWorkItem, addWorkItem } = await import('./workItems')

beforeEach(() => {
  calls.length = 0
})

describe('saveWorkItem', () => {
  it('upserts an MPG task as a statement row with no contact', async () => {
    await saveWorkItem({ key: 'mpg_task:t1', kind: 'mpg_task', book: 'mpg', contactId: 'm1' }, { status: 'working' })
    expect(calls[0]).toMatchObject({
      op: 'upsert',
      opts: { onConflict: 'user_id,source_key' },
      body: { source_key: 'mpg_task:t1', kind: 'statement', business_id: 'mpg', contact_id: null, status: 'working', waiting_on: null, check_back_on: null },
    })
  })

  it('stamps done_at when marking done', async () => {
    await saveWorkItem({ key: 'application:a', kind: 'application', book: 'bay', contactId: 'a' }, { status: 'done' })
    expect(calls[0].body.done_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('records the missing-docs count when an application is reviewed', async () => {
    await saveWorkItem({ key: 'application:a', kind: 'application', book: 'bay', contactId: 'a', docs: 2 }, { status: 'done' })
    expect(calls[0].body).toMatchObject({ status: 'done', review_docs: 2 })
    calls.length = 0
    await saveWorkItem({ key: 'estimate:e', kind: 'estimate', book: 'bay', contactId: 'e' }, { status: 'done' })
    expect(calls[0].body.review_docs).toBeUndefined()
  })

  it('updates a custom item by id', async () => {
    await saveWorkItem({ key: 'custom:c1', kind: 'custom', rowId: 'c1', book: 'bay' }, { status: 'waiting', waiting_on: 'Lender', check_back_on: '2026-10-26' })
    expect(calls[0]).toMatchObject({ op: 'update', eq: ['id', 'c1'], body: { status: 'waiting', waiting_on: 'Lender', check_back_on: '2026-10-26' } })
  })
})

describe('addWorkItem', () => {
  it('inserts a trimmed custom row', async () => {
    await addWorkItem({ book: 'bay', title: '  Order appraisal ', contactId: 'c9', notes: ' ' })
    expect(calls[0]).toMatchObject({ op: 'insert', body: { kind: 'custom', business_id: 'bay', title: 'Order appraisal', contact_id: 'c9', notes: null } })
  })
})
