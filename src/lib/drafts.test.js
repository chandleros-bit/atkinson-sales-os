import { describe, it, expect } from 'vitest'
import { changePct, composeUrl, planApproval, botLabel } from './drafts'

describe('drafts', () => {
  it('measures how much of the bot text changed', () => {
    expect(changePct('Hi Laura, join my class on the 14th', 'Hi Laura, join my class on the 14th')).toBe(0)
    expect(changePct('Hi Laura, join my class on the 14th', 'Hi Laura, join my AI class on the 14th')).toBe(11)
    expect(changePct('one two three', 'four five six')).toBe(100)
    expect(changePct('', '')).toBe(0)
  })

  it('builds a mailto link with subject and body filled in', () => {
    expect(composeUrl({ to_email: 'laura@compass.com', subject: 'Class on the 14th', body: 'Hi Laura,\nSee you there' }))
      .toBe('mailto:laura%40compass.com?subject=Class%20on%20the%2014th&body=Hi%20Laura%2C%0ASee%20you%20there')
  })

  it('records the final text and edit size on approval', () => {
    const now = new Date('2026-11-23T17:00:00Z')
    const d = { original_subject: 'Class invite', original_body: 'Hi Laura, want to join?' }
    expect(planApproval(d, { subject: 'Class invite', body: 'Hi Laura, want to join?' }, now)).toMatchObject({ status: 'approved', change_pct: 0, final_body: 'Hi Laura, want to join?', decided_at: now.toISOString() })
    expect(planApproval(d, { subject: 'Class invite', body: 'Laura, want to come?' }, now).change_pct).toBeGreaterThan(0)
    expect(botLabel('cold_email')).toBe('Cold Email')
  })
})
