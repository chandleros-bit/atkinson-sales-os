import { describe, it, expect } from 'vitest'
import {
  OUTCOMES,
  followUpDate,
  defaultFollowUpOn,
  defaultDurationMin,
  defaultFollowUpTitle,
  endOfTodayIso,
  buildActionRequest,
  retryRequestFor,
  summarizeResult,
  summarizeWriteback,
} from './crmActions'

// 2026-10-16 is a Friday.
const at = (iso) => new Date(iso)

describe('followUpDate', () => {
  it('moves "tomorrow" past the weekend', () => {
    expect(followUpDate('tomorrow', at('2026-10-14T10:00:00'))).toBe('2026-10-15') // Wed -> Thu
    expect(followUpDate('tomorrow', at('2026-10-16T10:00:00'))).toBe('2026-10-19') // Fri -> Mon
    expect(followUpDate('tomorrow', at('2026-10-17T10:00:00'))).toBe('2026-10-19') // Sat -> Mon
    expect(followUpDate('tomorrow', at('2026-10-18T10:00:00'))).toBe('2026-10-19') // Sun -> Mon
  })
  it('adds three days for "in3"', () => {
    expect(followUpDate('in3', at('2026-10-14T10:00:00'))).toBe('2026-10-17')
  })
  it('returns the next Monday, a full week out on a Monday', () => {
    expect(followUpDate('nextMonday', at('2026-10-14T10:00:00'))).toBe('2026-10-19')
    expect(followUpDate('nextMonday', at('2026-10-19T10:00:00'))).toBe('2026-10-26')
    expect(followUpDate('nextMonday', at('2026-10-18T10:00:00'))).toBe('2026-10-19')
  })
  it('passes a picked date through and requires one', () => {
    expect(followUpDate('pick', at('2026-10-14T10:00:00'), '2026-11-02')).toBe('2026-11-02')
    expect(() => followUpDate('pick', at('2026-10-14T10:00:00'))).toThrow()
  })
  it('uses the local date, not UTC, late in the evening', () => {
    expect(followUpDate('tomorrow', at('2026-10-14T23:30:00'))).toBe('2026-10-15')
  })
  it('rejects an unknown preset', () => {
    expect(() => followUpDate('someday', new Date())).toThrow()
  })
})

describe('outcome defaults', () => {
  it('lists FUB\'s six outcomes', () => {
    expect(OUTCOMES).toEqual(['Interested', 'Not interested', 'Left message', 'No answer', 'Busy', 'Bad number'])
  })
  it('turns the follow-up on only for non-connects worth retrying', () => {
    expect(OUTCOMES.filter(defaultFollowUpOn)).toEqual(['Left message', 'No answer', 'Busy'])
  })
  it('prefills 5 minutes for a conversation and 1 otherwise', () => {
    expect(defaultDurationMin('Interested')).toBe(5)
    expect(defaultDurationMin('Not interested')).toBe(5)
    expect(defaultDurationMin('Left message')).toBe(1)
    expect(defaultDurationMin('Bad number')).toBe(1)
  })
})

describe('defaultFollowUpTitle', () => {
  it('uses the first name', () => {
    expect(defaultFollowUpTitle('Jessica Chen')).toBe('Follow up: Jessica')
    expect(defaultFollowUpTitle('  ')).toBe('Follow up')
    expect(defaultFollowUpTitle(null)).toBe('Follow up')
  })
})

describe('endOfTodayIso', () => {
  it('is 23:59:59.999 local time today', () => {
    const iso = endOfTodayIso(at('2026-10-14T10:00:00'))
    const d = new Date(iso)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 14, 23, 59])
  })
})

describe('buildActionRequest', () => {
  const contactId = '11111111-1111-4111-8111-111111111111'

  it('builds a full log_call request with a fresh id each time', () => {
    const form = {
      action: 'log_call',
      contactId,
      outcome: 'Left message',
      note: '  call back after 3 ',
      durationMin: 1,
      followUp: { on: true, dueDate: '2026-10-19', title: 'Follow up: Jessica', type: 'Follow Up' },
      completeTaskId: 'task-1',
    }
    const a = buildActionRequest(form)
    const b = buildActionRequest(form)
    expect(a.client_action_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.client_action_id).not.toBe(b.client_action_id)
    expect(a).toEqual({
      client_action_id: a.client_action_id,
      action: 'log_call',
      contact_id: contactId,
      payload: {
        outcome: 'Left message',
        note: 'call back after 3',
        duration_min: 1,
        follow_up: { due_date: '2026-10-19', title: 'Follow up: Jessica', type: 'Follow Up' },
        complete_task_id: 'task-1',
      },
    })
  })

  it('drops an empty note, an off follow-up and no open task', () => {
    const r = buildActionRequest({
      action: 'log_call', contactId, outcome: 'Interested', note: '   ', durationMin: 5,
      followUp: { on: false, dueDate: '2026-10-19', title: 'x' }, completeTaskId: null,
    })
    expect(r.payload).toEqual({ outcome: 'Interested', duration_min: 5 })
  })

  it('requires an outcome for a call and a body for a note', () => {
    expect(() => buildActionRequest({ action: 'log_call', contactId, durationMin: 1 })).toThrow(/outcome/i)
    expect(() => buildActionRequest({ action: 'add_note', contactId, body: ' ' })).toThrow(/note/i)
  })

  it('builds note, task, complete and push requests', () => {
    expect(buildActionRequest({ action: 'add_note', contactId, body: 'Asked for W-2s' }).payload)
      .toEqual({ body: 'Asked for W-2s' })
    expect(buildActionRequest({ action: 'create_task', contactId, dueDate: '2026-10-20', title: 'Follow up: Ana', type: 'Call' }))
      .toMatchObject({ action: 'create_task', contact_id: contactId, payload: { due_date: '2026-10-20', title: 'Follow up: Ana', type: 'Call' } })
    expect(buildActionRequest({ action: 'complete_task', taskId: 't9' }))
      .toMatchObject({ action: 'complete_task', task_id: 't9', payload: {} })
    expect(buildActionRequest({ action: 'push_task', taskId: 't9', dueDate: '2026-10-21' }))
      .toMatchObject({ action: 'push_task', task_id: 't9', payload: { due_date: '2026-10-21' } })
  })

  it('rejects an unknown action', () => {
    expect(() => buildActionRequest({ action: 'delete_everything' })).toThrow()
  })
})

describe('retryRequestFor', () => {
  const original = {
    client_action_id: 'aaa',
    action: 'log_call',
    contact_id: 'c1',
    payload: {
      outcome: 'No answer', duration_min: 1,
      follow_up: { due_date: '2026-10-19', title: 'Follow up: Jo', type: 'Follow Up' },
      complete_task_id: 't1',
    },
  }
  it('retries only the failed follow-up, with a new id', () => {
    const r = retryRequestFor('create_task', original)
    expect(r).toMatchObject({
      action: 'create_task', contact_id: 'c1',
      payload: { due_date: '2026-10-19', title: 'Follow up: Jo', type: 'Follow Up' },
    })
    expect(r.client_action_id).not.toBe('aaa')
  })
  it('retries only the failed task completion', () => {
    expect(retryRequestFor('complete_task', original)).toMatchObject({ action: 'complete_task', task_id: 't1' })
  })
  it('retries a single-step request as itself, with a new id', () => {
    const single = { client_action_id: 'bbb', action: 'add_note', contact_id: 'c1', payload: { body: 'x' } }
    const r = retryRequestFor('add_note', single)
    expect(r).toMatchObject({ action: 'add_note', contact_id: 'c1', payload: { body: 'x' } })
    expect(r.client_action_id).not.toBe('bbb')
  })
})

describe('summarizeResult', () => {
  it('names the CRM on success', () => {
    expect(summarizeResult({ status: 'ok', results: [{ step: 'log_call', ok: true }] }, 'bay'))
      .toEqual({ tone: 'ok', text: 'Call logged in FollowUpBoss', failed: [] })
    expect(summarizeResult({ status: 'ok', results: [{ step: 'complete_task', ok: true }] }, 'mpg').text)
      .toBe('Task completed in Zoho')
  })
  it('lists every step that worked', () => {
    const res = { status: 'ok', results: [
      { step: 'log_call', ok: true }, { step: 'complete_task', ok: true }, { step: 'create_task', ok: true },
    ] }
    expect(summarizeResult(res, 'bay').text).toBe('Call logged, task completed and follow-up scheduled in FollowUpBoss')
  })
  it('says a reschedule when push fell back to complete-and-recreate', () => {
    expect(summarizeResult({ status: 'ok', results: [{ step: 'push_task', ok: true, rescheduled: true }] }, 'bay').text)
      .toBe('Task rescheduled in FollowUpBoss')
  })
  it('names the failed step on a partial', () => {
    const res = { status: 'partial', results: [
      { step: 'log_call', ok: true }, { step: 'create_task', ok: false, error: 'FUB 422' },
    ] }
    expect(summarizeResult(res, 'bay')).toEqual({
      tone: 'partial',
      text: 'Call logged in FollowUpBoss. Follow-up task failed: FUB 422.',
      failed: ['create_task'],
    })
  })
  it('explains an error or a refusal', () => {
    expect(summarizeResult({ status: 'error', results: [{ step: 'log_call', ok: false, error: 'boom' }] }, 'bay'))
      .toEqual({ tone: 'error', text: 'Call failed: boom.', failed: ['log_call'] })
    expect(summarizeResult({ status: 'refused', error: 'Write-back is off for MPG' }, 'mpg'))
      .toEqual({ tone: 'error', text: 'Write-back is off for MPG', failed: [] })
  })
})

describe('summarizeWriteback', () => {
  it('counts outcomes and surfaces the newest failure', () => {
    const rows = [
      { status: 'ok', created_at: '2026-10-18T15:00:00Z', results: [{ step: 'log_call', ok: true }] },
      { status: 'partial', created_at: '2026-10-18T14:00:00Z', results: [{ step: 'log_call', ok: true }, { step: 'create_task', ok: false, error: 'FUB 422' }] },
      { status: 'error', created_at: '2026-10-18T13:00:00Z', results: [{ step: 'log_call', ok: false, error: 'older' }] },
      { status: 'refused', created_at: '2026-10-18T12:00:00Z', results: [{ step: 'log_call', ok: false, error: 'Write-back is off for MPG' }] },
    ]
    expect(summarizeWriteback(rows)).toEqual({
      ok: 1, partial: 1, error: 1, refused: 1, pending: 0,
      latestError: { text: 'FUB 422', at: '2026-10-18T14:00:00Z', step: 'create_task' },
      lastAt: '2026-10-18T15:00:00Z',
    })
  })
  it('is empty for no rows', () => {
    expect(summarizeWriteback([])).toEqual({ ok: 0, partial: 0, error: 0, refused: 0, pending: 0, latestError: null, lastAt: null })
  })
})
