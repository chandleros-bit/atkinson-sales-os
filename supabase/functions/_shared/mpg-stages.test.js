import { describe, it, expect } from 'vitest'
import { MPG_STAGES, mpgStageFromStatus, mpgTarget, mpgTargetForStatus, isMpgStageTarget } from './mpg-stages.ts'

describe('MPG_STAGES', () => {
  it('lists the seven columns in board order', () => {
    expect(MPG_STAGES).toEqual(['Not Contacted', 'Initial Lead Follow Up', 'Open', 'Submitted', 'Approved', 'Closed Non-Compatible', 'Nurture'])
  })
})

describe('mpgStageFromStatus', () => {
  it('maps each Zoho Lead Status, ignoring case and spaces', () => {
    expect(mpgStageFromStatus('Not Contacted')).toBe('Not Contacted')
    expect(mpgStageFromStatus('Initial lead follow up')).toBe('Initial Lead Follow Up')
    expect(mpgStageFromStatus(' OPEN ')).toBe('Open')
    expect(mpgStageFromStatus('Submitted')).toBe('Submitted')
    expect(mpgStageFromStatus('Approved')).toBe('Approved')
    expect(mpgStageFromStatus('Closed non-compatible')).toBe('Closed Non-Compatible')
    expect(mpgStageFromStatus('Nurture')).toBe('Nurture')
  })
  it('reads older statuses as the nearest stage', () => {
    expect(mpgStageFromStatus('Attempted to Contact')).toBe('Initial Lead Follow Up')
    expect(mpgStageFromStatus('Pending')).toBe('Submitted')
    expect(mpgStageFromStatus('Declined')).toBe('Closed Non-Compatible')
  })
  it('passes unknown statuses through, Initial lead included (kept out of the OS)', () => {
    expect(mpgStageFromStatus('Initial lead')).toBe('Initial lead')
    expect(mpgStageFromStatus(' Custom ')).toBe('Custom')
    expect(mpgStageFromStatus('')).toBe(null)
    expect(mpgStageFromStatus(null)).toBe(null)
  })
})

describe('targets', () => {
  it('writes the exact Zoho picklist value', () => {
    expect(mpgTarget('follow_up').status).toBe('Initial lead follow up')
    expect(mpgTarget('closed_non_compatible').status).toBe('Closed non-compatible')
    expect(mpgTarget('lost')).toBe(null)
    expect(isMpgStageTarget('submitted')).toBe(true)
    expect(isMpgStageTarget('attempted')).toBe(false)
  })
  it('finds the target a lead is in now, for Undo', () => {
    expect(mpgTargetForStatus('Initial lead follow up')).toBe('follow_up')
    expect(mpgTargetForStatus('Pending')).toBe('submitted')
    expect(mpgTargetForStatus('Initial lead')).toBe(null)
  })
})
