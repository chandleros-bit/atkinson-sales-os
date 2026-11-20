import { describe, it, expect } from 'vitest'
import { offersFollowUp, fillTemplate, followUpLinks, followUpHint, callbackWorkItem } from './dialerFollowUp'

const lead = { first_name: 'Jane', last_name: 'Smith', company: 'Acme Cafe', phone_e164: '+17135550101', email: 'jane@acme.test', business_id: 'bay' }

describe('offersFollowUp', () => {
  it('follows the four warm outcomes only', () => {
    expect(['interested', 'appointment_set', 'callback_requested', 'application_sent'].every(offersFollowUp)).toBe(true)
    expect(offersFollowUp('no_answer')).toBe(false)
    expect(offersFollowUp('not_interested')).toBe(false)
  })
})

describe('fillTemplate', () => {
  it('fills the lead fields', () => {
    expect(fillTemplate('Hi {first_name}, about {company}.', lead)).toBe('Hi Jane, about Acme Cafe.')
    expect(fillTemplate('{name}', lead)).toBe('Jane Smith')
  })
  it('tidies a blank field', () => {
    expect(fillTemplate('Hi {first_name}, thanks.', { company: 'Acme' })).toBe('Hi, thanks.')
    expect(fillTemplate('Following up, {company}', {})).toBe('Following up')
  })
})

describe('followUpLinks', () => {
  const script = { sms_template: 'Hi {first_name}, apply: https://x.test/a?b=1&c=2', email_subject: 'Next steps, {company}', email_body: 'Hi {first_name},\nThanks.' }
  it('builds an sms: link with the filled body', () => {
    const { sms } = followUpLinks(lead, script)
    expect(sms).toBe(`sms:+17135550101?&body=${encodeURIComponent('Hi Jane, apply: https://x.test/a?b=1&c=2')}`)
  })
  it('builds a mailto: link with subject and body', () => {
    const { email } = followUpLinks(lead, script)
    expect(email).toBe(`mailto:jane%40acme.test?subject=${encodeURIComponent('Next steps, Acme Cafe')}&body=${encodeURIComponent('Hi Jane,\nThanks.')}`)
  })
  it('leaves out email when the lead has none', () => {
    expect(followUpLinks({ ...lead, email: null }, script).email).toBeNull()
  })
})

describe('followUpHint', () => {
  it('prompts for the Calendly link and the application link', () => {
    expect(followUpHint('appointment_set', 'bay')).toMatch(/Calendly/)
    expect(followUpHint('application_sent', 'bay')).toMatch(/application link/)
    expect(followUpHint('interested', 'mpg')).toBeNull()
  })
})

describe('callbackWorkItem', () => {
  it('is a custom Sales OS work item due on the callback day', () => {
    const item = callbackWorkItem(lead, new Date(2026, 10, 21, 10, 30).toISOString(), 'Wants rates')
    expect(item).toMatchObject({ business_id: 'bay', kind: 'custom', title: 'Callback: Jane Smith', due_on: '2026-11-21', status: 'open' })
    expect(item.notes).toMatch(/10:30 AM/)
    expect(item.notes).toMatch(/\(713\) 555-0101/)
    expect(item.notes).toMatch(/Wants rates/)
  })
  it('names the company when there is no person', () => {
    expect(callbackWorkItem({ company: 'Acme Cafe', business_id: 'mpg', phone_e164: '+17135550101' }, '2026-11-21T16:30:00Z').title).toBe('Callback: Acme Cafe')
  })
})
