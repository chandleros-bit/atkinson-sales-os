import { describe, it, expect } from 'vitest'
import { planSteps, shouldStop, overallStatus } from './plan.ts'

describe('planSteps', () => {
  it('orders a full Log call as call, complete, follow-up', () => {
    const steps = planSteps({
      action: 'log_call',
      contact_id: 'c1',
      payload: {
        outcome: 'Left Message', note: 'vm', duration_min: 1,
        complete_task_id: 't1',
        follow_up: { due_date: '2026-10-19', title: 'Follow up: Jo', type: 'Follow Up' },
      },
    })
    expect(steps.map((s) => s.step)).toEqual(['log_call', 'complete_task', 'create_task'])
    expect(steps[0]).toEqual({ step: 'log_call', outcome: 'Left Message', note: 'vm', durationMin: 1 })
    expect(steps[1]).toEqual({ step: 'complete_task', taskId: 't1' })
    expect(steps[2]).toEqual({ step: 'create_task', title: 'Follow up: Jo', type: 'Follow Up', dueDate: '2026-10-19' })
  })

  it('plans a bare call as one step', () => {
    expect(planSteps({ action: 'log_call', payload: { outcome: 'Busy' } }).map((s) => s.step)).toEqual(['log_call'])
  })

  it('plans each single action as one step', () => {
    expect(planSteps({ action: 'add_note', payload: { body: 'x' } })).toEqual([{ step: 'add_note', subject: null, body: 'x' }])
    expect(planSteps({ action: 'create_task', payload: { due_date: '2026-10-20', title: 'T' } }))
      .toEqual([{ step: 'create_task', title: 'T', type: 'Follow Up', dueDate: '2026-10-20' }])
    expect(planSteps({ action: 'complete_task', task_id: 't9', payload: {} })).toEqual([{ step: 'complete_task', taskId: 't9' }])
    expect(planSteps({ action: 'push_task', task_id: 't9', payload: { due_date: '2026-10-21' } }))
      .toEqual([{ step: 'push_task', taskId: 't9', dueDate: '2026-10-21' }])
    expect(planSteps({ action: 'whoami' })).toEqual([{ step: 'whoami' }])
  })

  it('throws on an unknown action', () => {
    expect(() => planSteps({ action: 'merge_contacts' })).toThrow(/Unknown action/)
  })
})

describe('shouldStop', () => {
  it('stops only after a failed call', () => {
    expect(shouldStop('log_call', false)).toBe(true)
    expect(shouldStop('log_call', true)).toBe(false)
    expect(shouldStop('complete_task', false)).toBe(false)
    expect(shouldStop('create_task', false)).toBe(false)
  })
})

describe('overallStatus', () => {
  it('is ok, partial or error', () => {
    expect(overallStatus([{ ok: true }, { ok: true }])).toBe('ok')
    expect(overallStatus([{ ok: true }, { ok: false }])).toBe('partial')
    expect(overallStatus([{ ok: false }])).toBe('error')
  })
})
