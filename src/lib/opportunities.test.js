import { describe, it, expect } from 'vitest'
import { planOutcome, addBusinessDays, isStale, OUTCOMES } from './opportunities'

const pick = { id: 'p1', contact_id: 'c1', pick_date: '2026-11-18', status: 'pending', ai_note: { fub_task: 'CA: Mortgage review follow-up with Maria' } }

describe('planOutcome', () => {
  it('writes exactly one FUB note per outcome and only creates a task on No answer', () => {
    for (const { key } of OUTCOMES) {
      const p = planOutcome({ pick, outcome: key, note: 'Talked rates', today: '2026-11-18', clientActionId: 'u1' })
      expect(p.crmRequest.action).toBe('add_note')
      expect(p.crmRequest.client_action_id).toBe('u1')
      expect(p.crmRequest.contact_id).toBe('c1')
      expect(p.patch.status).toBe(key)
      expect(Boolean(p.workItem)).toBe(key === 'no_answer')
    }
  })
  it('No answer creates a Sales OS task due in 2 business days', () => {
    const p = planOutcome({ pick, outcome: 'no_answer', note: '', today: '2026-11-20', clientActionId: 'u' })
    expect(p.workItem).toMatchObject({ kind: 'custom', status: 'open', due_on: '2026-11-24', title: 'CA: Mortgage review follow-up with Maria' })
    expect(p.crmRequest.payload.body).toBe('Mortgage review call, no answer')
  })
  it('Connected puts Chandler\'s note in the FUB note', () => {
    const p = planOutcome({ pick, outcome: 'connected', note: ' Wants numbers on a cash-out ', today: '2026-11-18', clientActionId: 'u' })
    expect(p.crmRequest.payload.body).toBe('Mortgage review call, connected. Wants numbers on a cash-out')
    expect(p.patch.outcome_note).toBe('Wants numbers on a cash-out')
  })
  it('rejects an unknown outcome', () => {
    expect(() => planOutcome({ pick, outcome: 'maybe', today: '2026-11-18' })).toThrow()
  })
})

describe('dates', () => {
  it('skips weekends', () => {
    expect(addBusinessDays('2026-11-20', 1)).toBe('2026-11-23')
    expect(addBusinessDays('2026-11-18', 2)).toBe('2026-11-20')
  })
  it('a pending pick drops off Today after 3 business days', () => {
    expect(isStale(pick, '2026-11-20')).toBe(false)
    expect(isStale(pick, '2026-11-23')).toBe(true)
    expect(isStale({ ...pick, status: 'connected' }, '2026-12-01')).toBe(false)
  })
})
