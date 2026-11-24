import { describe, it, expect } from 'vitest'
import { noteDate, agentUpdateText, outcomeForKey } from './afterCall'

// Monday, Nov 23 2026, 10 AM local.
const NOW = new Date('2026-11-23T10:00:00').getTime()

describe('noteDate', () => {
  it('reads a weekday as its next occurrence, with the sentence as the reason', () => {
    expect(noteDate('UW cleared 2 of 3 conditions. Still waiting on the gift letter, expects it Wednesday.', NOW)).toEqual({
      date: '2026-11-25',
      label: 'Wed',
      title: 'Check back · Still waiting on the gift letter, expects it Wednesday',
    })
    expect(noteDate('call back fri', NOW).date).toBe('2026-11-27')
    // Today's weekday means next week.
    expect(noteDate('talk Monday', NOW).date).toBe('2026-11-30')
  })

  it('reads tomorrow, next week and calendar dates', () => {
    expect(noteDate('Send the estimate tomorrow', NOW)).toMatchObject({ date: '2026-11-24', label: 'Tomorrow' })
    expect(noteDate('Revisit next week', NOW)).toMatchObject({ date: '2026-11-30', label: 'Nov 30' })
    expect(noteDate('Closing set for Dec 4', NOW)).toMatchObject({ date: '2026-12-04', label: 'Dec 4' })
    expect(noteDate('appraisal 12/9', NOW)).toMatchObject({ date: '2026-12-09', label: 'Dec 9' })
    // A past date rolls to next year.
    expect(noteDate('funded Nov 2', NOW).date).toBe('2027-11-02')
  })

  it('takes the first date named and ignores notes without one', () => {
    expect(noteDate('Thursday, then again Dec 10', NOW).date).toBe('2026-11-26')
    expect(noteDate('Left a voicemail', NOW)).toBe(null)
    expect(noteDate('', NOW)).toBe(null)
  })
})

describe('agentUpdateText', () => {
  it('drafts a short update from the note', () => {
    expect(agentUpdateText({ agentName: 'Jenna Kim', borrowerName: 'Priya Shah', note: 'UW cleared 2 of 3 conditions, waiting on the gift letter.' })).toBe(
      'Hi Jenna, quick update on Priya Shah: UW cleared 2 of 3 conditions, waiting on the gift letter. - Chandler',
    )
    expect(agentUpdateText({ agentName: 'Jenna', borrowerName: 'Priya', note: '  ' })).toBe(null)
  })
})

describe('outcomeForKey', () => {
  it('maps 1-6 onto the outcomes in order', () => {
    const outcomes = ['Interested', 'Not Interested', 'Left Message', 'No Answer', 'Busy', 'Bad Number']
    expect(outcomeForKey('1', outcomes)).toBe('Interested')
    expect(outcomeForKey('4', outcomes)).toBe('No Answer')
    expect(outcomeForKey('7', outcomes)).toBe(null)
    expect(outcomeForKey('a', outcomes)).toBe(null)
  })
})
