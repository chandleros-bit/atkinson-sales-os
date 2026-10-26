import { describe, it, expect } from 'vitest'
import { parseVoiceTask } from './voiceTask'

// Local time, as the other day-math tests. 2026-10-22 is a Thursday.
const NOW = new Date('2026-10-22T10:00:00').getTime()
const parse = (text) => parseVoiceTask(text, NOW)

describe('parseVoiceTask', () => {
  it('reads the book, the task, the due day and who it is about', () => {
    expect(parse('MPG send Vinay picture of shipping receipt for reimbursement, today')).toEqual({
      book: 'mpg',
      title: 'Send Vinay picture of shipping receipt for reimbursement',
      dueOn: '2026-10-22',
      names: ['Vinay'],
    })
  })

  it('hears the book however speech writes it', () => {
    expect(parse('m p g call the bank').book).toBe('mpg')
    expect(parse('M.P.G. call the bank').book).toBe('mpg')
    expect(parse('Bayway order appraisal for Ana Ruiz').book).toBe('bay')
    expect(parse('bay way order appraisal').book).toBe('bay')
    expect(parse('order appraisal').book).toBe(null)
    expect(parse('Bayway, order appraisal').title).toBe('Order appraisal')
  })

  it('reads relative days', () => {
    expect(parse('call lender tomorrow').dueOn).toBe('2026-10-23')
    expect(parse('call lender tonight').dueOn).toBe('2026-10-22')
    expect(parse('call lender by Monday').dueOn).toBe('2026-10-26')
    expect(parse('call lender on Thursday').dueOn).toBe('2026-10-29') // today is Thursday: next one
    expect(parse('call lender next Tuesday').dueOn).toBe('2026-10-27') // already next week
    expect(parse('call lender next Friday').dueOn).toBe('2026-10-30') // not tomorrow
    expect(parse('call lender next week').dueOn).toBe('2026-10-26')
    expect(parse('call lender end of week').dueOn).toBe('2026-10-23')
    expect(parse('call lender in 3 days').dueOn).toBe('2026-10-25')
    expect(parse('call lender in two weeks').dueOn).toBe('2026-11-05')
  })

  it('reads calendar dates, rolling past ones into next year', () => {
    expect(parse('send docs October 30th').dueOn).toBe('2026-10-30')
    expect(parse('send docs due Nov 2').dueOn).toBe('2026-11-02')
    expect(parse('send docs by 11/5').dueOn).toBe('2026-11-05')
    expect(parse('send docs Jan 3').dueOn).toBe('2027-01-03')
  })

  it('takes the date out of the title, with its "due" / "by" / "on"', () => {
    expect(parse('Bayway send docs due tomorrow').title).toBe('Send docs')
    expect(parse('MPG call Rita by Friday.').title).toBe('Call Rita')
    expect(parse('MPG today call Rita').title).toBe('Call Rita')
  })

  it('leaves the due day empty when none is said', () => {
    expect(parse('MPG send Vinay the receipt')).toMatchObject({ dueOn: null, title: 'Send Vinay the receipt' })
  })

  it('suggests the names to look up as leads', () => {
    expect(parse('MPG call ana ruiz about her statements').names).toEqual(['ana'])
    expect(parse('Bayway email John Smith the estimate').names).toEqual(['John', 'Smith'])
    expect(parse('Bayway order appraisal').names).toEqual([])
  })

  it('gives nothing for silence', () => {
    expect(parse('   ')).toEqual({ book: null, title: '', dueOn: null, names: [] })
  })
})
