import { describe, it, expect } from 'vitest'
import { noteFacts } from './noteFacts'

describe('noteFacts', () => {
  it('splits a lead provider note into labelled facts, dropping the email', () => {
    const text = 'Credit: 660-699 / email: sample@example.com / loan type: DSCR Purchase / state: North Carolina / loan amount: $200K - $500K'
    expect(noteFacts(text)).toEqual({
      facts: [
        { k: 'Credit', v: '660-699' },
        { k: 'Loan type', v: 'DSCR Purchase' },
        { k: 'State', v: 'North Carolina' },
        { k: 'Amount', v: '$200K - $500K' },
      ],
      snippet: '',
    })
  })
  it('reads one fact per line too, and drops phone numbers', () => {
    expect(noteFacts('Loan Purpose: Refinance\nPhone: 713-555-0100\nProperty Value: $450,000').facts).toEqual([
      { k: 'Loan purpose', v: 'Refinance' },
      { k: 'Property value', v: '$450,000' },
    ])
  })
  it('falls back to a short snippet for free text', () => {
    const r = noteFacts('Wants to refinance after rates drop, call evenings only. Has two rentals in Katy.')
    expect(r.facts).toEqual([])
    expect(r.snippet).toBe('Wants to refinance after rates drop, call evenings only. Has two rentals in Katy.')
    expect(noteFacts('x'.repeat(300)).snippet).toHaveLength(140)
  })
  it('gives nothing for an empty note', () => {
    expect(noteFacts(null)).toEqual({ facts: [], snippet: '' })
    expect(noteFacts('   ')).toEqual({ facts: [], snippet: '' })
  })
})
