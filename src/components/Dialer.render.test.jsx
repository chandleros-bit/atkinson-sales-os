// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const invoke = vi.fn()
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: () => { const q = {}; for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit']) q[m] = () => q; q.maybeSingle = async () => ({ data: { value: { bay: true, mpg: true } }, error: null }); q.then = (r) => r({ data: [], error: null }); return q },
    functions: { invoke: (...a) => invoke(...a) },
  },
}))
vi.mock('./PersonSheet', () => ({ openPerson: () => {} }))
const { default: Dialer } = await import('./Dialer')

const item = (o = {}) => ({ id: 'a', book: 'bay', kind: 'attempt', step: 1, calls: 0, dueAt: 0, label: 'Attempt 1', hint: 'speed to lead', textKey: 'a1', row: { id: 'a', name: 'Sam Golden', phone: '9137135946', stage: 'New Lead', business_id: 'bay', crm_profile_url: '#' }, ...o })
const ok = (steps) => ({ data: { status: 'ok', results: steps.map((step) => ({ step, ok: true })) }, error: null })
const button = (t) => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t))
const click = (el) => act(async () => el.click())

async function open(items, extra = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onClose = vi.fn()
  const skipToday = vi.fn(async () => {})
  await act(async () => createRoot(host).render(React.createElement(Dialer, { items, start: 0, onClose, skipToday, ...extra })))
  return { onClose, skipToday }
}

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  invoke.mockResolvedValue(ok(['log_call', 'set_stage']))
})

describe('Dialer', () => {
  it('logs a no answer, moves a New Lead to Attempted, then offers the attempt-1 text', async () => {
    await open([item()])
    expect(document.body.textContent).toContain('(913) 713-5946')
    expect(button('Call on phone').getAttribute('href')).toBe('tel:9137135946')
    await click(button('No answer'))
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'log_call', contact_id: 'a', payload: { outcome: 'No Answer', duration_min: 1, next_step: 'scheduled', set_stage: 'attempted' } })
    const text = button('Text')
    expect(text.getAttribute('href')).toMatch(/^sms:9137135946\?&body=Hi%20Sam%2C%20this%20is%20Chandler/)
    invoke.mockResolvedValue(ok(['add_note']))
    await click(button('Log text'))
    expect(invoke.mock.calls[1][1].body).toMatchObject({ action: 'add_note', contact_id: 'a', payload: { body: expect.stringMatching(/^Texted: Hi Sam/) } })
  })

  it('offers Move to Nurture after the sixth Bayway attempt', async () => {
    await open([item({ step: 6, calls: 5, label: 'Attempt 6', textKey: 'a6', row: { ...item().row, stage: 'Attempted' } })])
    await click(button('Left voicemail'))
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ outcome: 'Left Message' })
    invoke.mockResolvedValue(ok(['set_stage']))
    await click(button('Move to Nurture'))
    expect(invoke.mock.calls[1][1].body).toMatchObject({ action: 'set_stage', contact_id: 'a', payload: { target: 'nurture' } })
  })

  it('skips, takes a lead off for today, and ends with a summary', async () => {
    const { skipToday, onClose } = await open([item(), item({ id: 'b', row: { ...item().row, id: 'b', name: 'Dawn Gast' } })])
    await click(button('Not today'))
    expect(skipToday).toHaveBeenCalledWith('a')
    expect(document.body.textContent).toContain('Dawn Gast')
    await click(button('Next'))
    expect(document.body.textContent).toContain('Done for now')
    await click(button('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps Nurture and Lost to leads: a realtor with a bad number just moves on', async () => {
    invoke.mockResolvedValue(ok(['log_call']))
    await open([item({ kind: 'new_realtor', step: null, calls: 0, label: 'New realtor · intro call', textKey: 'new_realtor', row: { ...item().row, stage: null } })])
    await click(button('Bad number'))
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ outcome: 'Bad Number' })
    expect(button('Move to Nurture')).toBe(undefined)
    expect(button('Mark Lost')).toBe(undefined)
  })

  it('shows a CRM error with Retry and stays on the lead', async () => {
    invoke.mockResolvedValue({ data: { status: 'error', results: [{ step: 'log_call', ok: false, error: 'FUB down' }] }, error: null })
    await open([item()])
    await click(button('No answer'))
    expect(document.querySelector('[role="alert"]').textContent).toContain('FUB down')
    expect(document.body.textContent).toContain('Sam Golden')
  })
  describe('Tuesday loan agents', () => {
    const loan = item({ id: 'b1', kind: 'loan_status', step: null, label: 'Loan status update', hint: 'never called', textKey: 'loan_status', row: { id: 'b1', name: 'Jo Ramirez', phone: '7135550100', stage: 'Disclosed', business_id: 'bay', crm_profile_url: '#' } })
    const agents = new Map([['b1', [
      { id: 'a1', contact_id: 'b1', kind: 'buyer_agent', name: 'Jane Smith', phone: '281-555-0100', matched_contact_id: 'r9', matched_phone: '2815550100' },
      { id: 'a2', contact_id: 'b1', kind: 'seller_agent', name: 'Sam Seller', phone: '832-555-0111', matched_contact_id: null, matched_phone: null },
    ]]])
    const agentRow = (name) => [...document.querySelectorAll('[data-agent]')].find((el) => el.textContent.includes(name))
    const inRow = (row, t) => [...row.querySelectorAll('button, a')].find((b) => b.textContent.trim() === t)

    it("logs a matched agent's call on their own record", async () => {
      invoke.mockResolvedValue(ok(['log_call']))
      await open([loan], { agents, agentsChecked: true })
      const jane = agentRow('Jane Smith')
      expect(inRow(jane, 'Call').getAttribute('href')).toBe('tel:2815550100')
      expect(decodeURIComponent(inRow(jane, 'Text').getAttribute('href'))).toContain("Quick check in on Jo Ramirez's loan")
      await click(inRow(jane, 'Voicemail'))
      const body = invoke.mock.calls[0][1].body
      expect(body).toMatchObject({ action: 'log_call', contact_id: 'r9', payload: { outcome: 'Left Message', next_step: 'scheduled' } })
      expect(agentRow('Jane Smith').textContent).toContain('Logged: Voicemail')
    })

    it('logs an unmatched agent as a note on the borrower', async () => {
      invoke.mockResolvedValue(ok(['add_note']))
      await open([loan], { agents, agentsChecked: true })
      await click(inRow(agentRow('Sam Seller'), 'Talked'))
      expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'add_note', contact_id: 'b1', payload: { body: "Called seller's agent Sam Seller: talked" } })
    })

    it('asks for agents when FUB has none', async () => {
      await open([loan], { agents: new Map(), agentsChecked: true })
      expect(document.querySelector('[data-agent-calls]').textContent).toContain('Add agents in FUB')
    })

    it('shows no agent block outside the loan list', async () => {
      await open([item()], { agents, agentsChecked: true })
      expect(document.querySelector('[data-agent-calls]')).toBe(null)
    })
  })
})
