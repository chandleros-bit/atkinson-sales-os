import { describe, it, expect } from 'vitest'
import { REVIEW_STEPS, reviewDone, reminderText, reminderLinks, fileChips, doneChoices, nextFile } from './fileSheet'

describe('review steps', () => {
  it('counts the checked steps', () => {
    expect(REVIEW_STEPS).toHaveLength(5)
    expect(reviewDone({ credit: true, income: true, dti: false })).toBe(2)
    expect(reviewDone(null)).toBe(0)
  })
})

describe('doc reminder', () => {
  it('lists every missing doc in one message', () => {
    expect(reminderText('Alicia Gomez', ['2025 W-2s', 'October bank statement', 'Letter of explanation'])).toBe(
      'Hi Alicia, a quick reminder on what I still need for your loan: 2025 W-2s, October bank statement and Letter of explanation. You can text or email them to me. Thanks! - Chandler',
    )
    expect(reminderText('Ben', ['Pay stubs'])).toContain('for your loan: Pay stubs.')
    expect(reminderText('Ben', [])).toBe(null)
  })

  it('drafts text and email links, never sends', () => {
    const l = reminderLinks({ name: 'Ben Ortiz', phone: '(713) 555-0101', email: 'ben@x.com', docs: ['Pay stubs'] })
    expect(l.sms.startsWith('sms:7135550101?&body=Hi%20Ben')).toBe(true)
    expect(l.email).toContain('mailto:ben@x.com?subject=Documents%20for%20your%20loan&body=')
    expect(reminderLinks({ name: 'Ben', docs: ['Pay stubs'] })).toMatchObject({ sms: null, email: null })
  })
})

describe('chips and choices', () => {
  it('builds the header chips from the item and loan', () => {
    const loan = { loan_type: 'FHA', amount: 310000, stage: 'Loan Setup', lender: 'UWM', buyer_agent_name: 'Marco Diaz' }
    expect(fileChips({ why: 'Application Received 9 days' }, loan)).toEqual(['Application Received 9 days', 'FHA · $310,000', 'Arive: Loan Setup · UWM', 'Realtor: Marco Diaz'])
    expect(fileChips({ why: '2 docs missing' })).toEqual(['2 docs missing'])
  })

  it('offers the right outcomes per kind', () => {
    expect(doneChoices({ kind: 'application', name: 'Alicia' }).map((c) => c.key)).toEqual(['pre_approved', 'disclosed', 'reviewed'])
    expect(doneChoices({ kind: 'application', name: 'Alicia' })[0].explain).toContain('Moves Alicia to Pre-Approved')
    expect(doneChoices({ kind: 'estimate' }).map((c) => c.target)).toEqual(['estimate_sent', 'application_sent'])
    expect(doneChoices({ kind: 'mpg_task' })[0].action).toBe('complete')
    expect(doneChoices({ kind: 'custom' })[0].action).toBe('done')
  })

  it('finds the next file', () => {
    const items = [{ key: 'a' }, { key: 'b' }]
    expect(nextFile(items, 'a').key).toBe('b')
    expect(nextFile(items, 'b')).toBe(null)
    expect(nextFile(items, 'gone').key).toBe('a')
  })
})
