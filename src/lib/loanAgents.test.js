import { describe, it, expect } from 'vitest'
import { agentsByContact } from './loanAgents'

describe('agentsByContact', () => {
  it("groups agents by borrower with the buyer's agent first", () => {
    const m = agentsByContact([
      { id: 1, contact_id: 'a', kind: 'seller_agent', name: 'Sam Seller' },
      { id: 2, contact_id: 'b', kind: 'buyer_agent', name: 'Bo Buyer' },
      { id: 3, contact_id: 'a', kind: 'buyer_agent', name: 'Jane Smith' },
    ])
    expect(m.get('a').map((r) => r.name)).toEqual(['Jane Smith', 'Sam Seller'])
    expect(m.get('b').map((r) => r.name)).toEqual(['Bo Buyer'])
    expect(m.has('c')).toBe(false)
  })
  it('takes nothing', () => {
    expect(agentsByContact(null).size).toBe(0)
  })
})
