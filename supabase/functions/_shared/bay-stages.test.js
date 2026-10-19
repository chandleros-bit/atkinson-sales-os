import { describe, it, expect } from 'vitest'
import { BAY_STAGES, STAGE_TARGETS, bayStageFromTags, retagForTarget, targetForStage } from './bay-stages.ts'

describe('BAY_STAGES', () => {
  it('lists the five columns in board order', () => {
    expect(BAY_STAGES).toEqual(['New Lead', 'Attempted', 'Contacted/Working', 'Application/Estimate Sent', 'Application Received'])
  })
})

describe('bayStageFromTags', () => {
  it('puts a Lead with no workflow tag in New Lead', () => {
    expect(bayStageFromTags(['DSCR', 'Active'], 'Lead')).toBe('New Lead')
    expect(bayStageFromTags(null, 'Lead')).toBe('New Lead')
  })
  it('maps each workflow tag, ignoring case and spaces', () => {
    expect(bayStageFromTags(['Attempted'], 'Lead')).toBe('Attempted')
    expect(bayStageFromTags([' working estimate '], 'Lead')).toBe('Contacted/Working')
    expect(bayStageFromTags(['estimate sent'], 'Lead')).toBe('Application/Estimate Sent')
    expect(bayStageFromTags(['application sent'], 'Lead')).toBe('Application/Estimate Sent')
    expect(bayStageFromTags(['Application Received'], 'Lead')).toBe('Application Received')
    expect(bayStageFromTags(['need docs'], 'Lead')).toBe('Application Received')
    expect(bayStageFromTags(['under contract'], 'Lead')).toBe('Application Received')
  })
  it('uses the furthest stage when several workflow tags are present', () => {
    expect(bayStageFromTags(['attempted', 'estimate sent', 'Working Estimate'], 'Lead')).toBe('Application/Estimate Sent')
  })
  it('treats Pre-Qualified as Application Received', () => {
    expect(bayStageFromTags([], 'Pre-Qualified')).toBe('Application Received')
    expect(bayStageFromTags(['attempted'], 'Pre-Qualified')).toBe('Application Received')
  })
  it('keeps Nurture, Realtors, Closed and Lost off the board, whatever the tags', () => {
    for (const s of ['Nurture', 'Realtors', 'Closed', 'Lost', null]) {
      expect(bayStageFromTags(['estimate sent'], s)).toBe(null)
    }
  })
})

describe('retagForTarget', () => {
  const others = ['DSCR', 'Active', 'HOT']

  it('adds the target tag and removes other columns\' workflow tags, keeping the rest', () => {
    expect(retagForTarget([...others, 'attempted'], 'working')).toEqual([...others, 'Working Estimate'])
  })
  it('moves back to New Lead by removing every workflow tag', () => {
    expect(retagForTarget(['estimate sent', 'Active', 'need docs'], 'new_lead')).toEqual(['Active'])
  })
  it('keeps a target-column tag in the user\'s own casing instead of adding a duplicate', () => {
    expect(retagForTarget(['WORKING ESTIMATE', 'Active'], 'working')).toEqual(['WORKING ESTIMATE', 'Active'])
  })
  it('switches between estimate sent and application sent', () => {
    expect(retagForTarget(['estimate sent', 'Active'], 'application_sent')).toEqual(['Active', 'application sent'])
    expect(retagForTarget(['application sent'], 'estimate_sent')).toEqual(['estimate sent'])
  })
  it('keeps need docs / under contract when moving within Application Received', () => {
    expect(retagForTarget(['need docs', 'estimate sent'], 'application_received')).toEqual(['need docs'])
    expect(retagForTarget(['Active'], 'application_received')).toEqual(['Active', 'application received'])
  })
  it('rejects an unknown target', () => {
    expect(() => retagForTarget([], 'closed')).toThrow(/Unknown stage target/)
  })
  it('lists six targets', () => {
    expect(STAGE_TARGETS.map((t) => t.key)).toEqual(['new_lead', 'attempted', 'working', 'estimate_sent', 'application_sent', 'application_received'])
  })
})

describe('targetForStage', () => {
  it('picks the current target for a lead from its tags', () => {
    expect(targetForStage(['application sent'], 'Lead')).toBe('application_sent')
    expect(targetForStage(['estimate sent'], 'Lead')).toBe('estimate_sent')
    expect(targetForStage([], 'Lead')).toBe('new_lead')
    expect(targetForStage(['need docs'], 'Lead')).toBe('application_received')
  })
})
