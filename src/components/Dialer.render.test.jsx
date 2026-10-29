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

  it('shows a CRM error with Retry and stays on the lead', async () => {
    invoke.mockResolvedValue({ data: { status: 'error', results: [{ step: 'log_call', ok: false, error: 'FUB down' }] }, error: null })
    await open([item()])
    await click(button('No answer'))
    expect(document.querySelector('[role="alert"]').textContent).toContain('FUB down')
    expect(document.body.textContent).toContain('Sam Golden')
  })
})
