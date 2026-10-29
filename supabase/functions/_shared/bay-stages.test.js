import { describe, it, expect } from 'vitest'
import { BAY_STAGES, STAGE_TARGETS, REVIEWED_TAGS, bayStageFromTags, retagForTarget, targetForStage } from './bay-stages.ts'

describe('BAY_STAGES', () => {
  it('lists the seven columns in board order', () => {
    expect(BAY_STAGES).toEqual(['New Lead', 'Attempted', 'Contacted/Working', 'Application/Estimate Sent', 'Application Received', 'Disclosed', 'Nurture / Credit Repair'])
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
  it('parks a Credit Repair lead in Nurture / Credit Repair over any other stage tag (Smart List 11)', () => {
    expect(bayStageFromTags(['Credit Repair'], 'Lead')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['DSCR', ' credit repair '], 'Lead')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['application received', 'Credit Repair'], 'Lead')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['Credit Repair'], 'Pre-Qualified')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['Credit Repair'], 'Nurture')).toBe(null)
  })
  it('parks a Nurture-tagged lead in the same column, any case', () => {
    expect(bayStageFromTags(['Nurture'], 'Lead')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['lendgo', ' nurture '], 'Lead')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['estimate sent', 'Nurture'], 'Pre-Qualified')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['Lost', 'Nurture'], 'Lead')).toBe('Lost')
    expect(bayStageFromTags(['Nurture'], 'Nurture')).toBe(null)
  })
  it('puts a Disclosed-tagged lead in Disclosed, past Application Received, Pre-Qualified included', () => {
    expect(bayStageFromTags(['Disclosed'], 'Lead')).toBe('Disclosed')
    expect(bayStageFromTags(['application received', 'under contract', ' disclosed '], 'Lead')).toBe('Disclosed')
    expect(bayStageFromTags(['Disclosed', 'under contract'], 'Pre-Qualified')).toBe('Disclosed')
    expect(bayStageFromTags(['Disclosed', 'Nurture'], 'Lead')).toBe('Nurture / Credit Repair')
    expect(bayStageFromTags(['Disclosed', 'Lost'], 'Lead')).toBe('Lost')
    expect(bayStageFromTags(['Disclosed'], 'Closed')).toBe(null)
  })
  it('treats Pre-Qualified as Application Received', () => {
    expect(bayStageFromTags([], 'Pre-Qualified')).toBe('Application Received')
    expect(bayStageFromTags(['attempted'], 'Pre-Qualified')).toBe('Application Received')
  })
  it('marks a Lost-tagged lead Lost, over Credit Repair and every other stage tag', () => {
    expect(bayStageFromTags(['Lost', 'attempted'], 'Lead')).toBe('Lost')
    expect(bayStageFromTags([' lost ', 'Credit Repair'], 'Lead')).toBe('Lost')
    expect(bayStageFromTags(['Lost'], 'Pre-Qualified')).toBe('Lost')
    expect(bayStageFromTags(['Lost'], 'Nurture')).toBe(null)
  })
  it('keeps Nurture, Realtors, Closed and Lost off the board, whatever the tags', () => {
    for (const s of ['Nurture', 'Realtors', 'Closed', 'Lost', null]) {
      expect(bayStageFromTags(['estimate sent'], s)).toBe(null)
    }
  })
})

describe('retagForTarget', () => {
  const others = ['DSCR', 'Active', 'HOT']

  it('adds the Pre-Approved review tag without moving the lead', () => {
    expect(retagForTarget(['DSCR', 'application received', 'need docs'], 'pre_approved')).toEqual(['DSCR', 'application received', 'need docs', 'Pre-Approved'])
    expect(retagForTarget(['application received', 'pre-approved'], 'pre_approved')).toEqual(['application received', 'pre-approved'])
  })
  it('moves to Disclosed keeping the application tags (for the Under Contract pipeline) and dropping earlier ones', () => {
    expect(retagForTarget(['application received'], 'disclosed')).toEqual(['application received', 'Disclosed'])
    expect(retagForTarget(['DSCR', 'need docs', 'under contract', 'Pre-Approved'], 'disclosed')).toEqual(['DSCR', 'need docs', 'under contract', 'Pre-Approved', 'Disclosed'])
    expect(retagForTarget(['attempted', 'Credit Repair', 'DSCR'], 'disclosed')).toEqual(['DSCR', 'Disclosed'])
    expect(retagForTarget(['disclosed'], 'disclosed')).toEqual(['disclosed'])
    expect(retagForTarget(['Disclosed', 'application received'], 'application_received')).toEqual(['application received'])
  })

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
  it('parks in Credit Repair by swapping out other stage tags, and un-parks by removing it', () => {
    expect(retagForTarget(['application received', 'DSCR'], 'credit_repair')).toEqual(['DSCR', 'Credit Repair'])
    expect(retagForTarget(['Credit Repair', 'DSCR'], 'attempted')).toEqual(['DSCR', 'attempted'])
    expect(retagForTarget(['credit repair'], 'credit_repair')).toEqual(['credit repair'])
  })
  it('tags Nurture or Credit Repair, never both: picking one swaps out the other', () => {
    expect(retagForTarget(['attempted', 'DSCR'], 'nurture')).toEqual(['DSCR', 'Nurture'])
    expect(retagForTarget(['Credit Repair', 'DSCR'], 'nurture')).toEqual(['DSCR', 'Nurture'])
    expect(retagForTarget(['nurture', 'DSCR'], 'credit_repair')).toEqual(['DSCR', 'Credit Repair'])
    expect(retagForTarget(['nurture'], 'nurture')).toEqual(['nurture'])
    expect(retagForTarget(['Nurture', 'DSCR'], 'attempted')).toEqual(['DSCR', 'attempted'])
  })
  it('marks Lost by swapping out stage tags, and un-marks it on any move', () => {
    expect(retagForTarget(['attempted', 'DSCR'], 'lost')).toEqual(['DSCR', 'Lost'])
    expect(retagForTarget(['DSCR', 'Lost'], 'attempted')).toEqual(['DSCR', 'attempted'])
    expect(retagForTarget(['Lost', 'Credit Repair'], 'new_lead')).toEqual([])
  })
  it('rejects an unknown target', () => {
    expect(() => retagForTarget([], 'closed')).toThrow(/Unknown stage target/)
  })
  it('lists ten targets, Disclosed after Application Received, Nurture and Credit Repair as two, Lost last', () => {
    expect(STAGE_TARGETS.map((t) => t.key)).toEqual(['new_lead', 'attempted', 'working', 'estimate_sent', 'application_sent', 'application_received', 'disclosed', 'nurture', 'credit_repair', 'lost'])
    expect(STAGE_TARGETS.filter((t) => t.stage === 'Nurture / Credit Repair').map((t) => t.label)).toEqual(['Nurture', 'Credit Repair'])
  })
})

describe('targetForStage', () => {
  it('picks the current target for a lead from its tags', () => {
    expect(targetForStage(['application sent'], 'Lead')).toBe('application_sent')
    expect(targetForStage(['estimate sent'], 'Lead')).toBe('estimate_sent')
    expect(targetForStage([], 'Lead')).toBe('new_lead')
    expect(targetForStage(['need docs'], 'Lead')).toBe('application_received')
    expect(targetForStage(['Lost'], 'Lead')).toBe('lost')
    expect(targetForStage(['estimate sent'], 'Nurture')).toBe(null)
    expect(targetForStage(['Nurture'], 'Lead')).toBe('nurture')
    expect(targetForStage(['Disclosed'], 'Pre-Qualified')).toBe('disclosed')
    expect(targetForStage(['credit repair'], 'Lead')).toBe('credit_repair')
  })
})

describe('REVIEWED_TAGS', () => {
  it('Pre-Approved or Disclosed means the application review is done', () => {
    expect(REVIEWED_TAGS).toEqual(['pre-approved', 'disclosed'])
  })
})
