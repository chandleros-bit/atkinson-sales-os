// @vitest-environment jsdom
// The Docs editor on the Person sheet's Loan tab (spec 2026-11-05).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { tracking: null, docs: [] }
const rpc = vi.fn()
function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => {
    if (table === 'contacts') return { data: { external_id: '2972' }, error: null }
    if (table === 'borrower_doc_tracking') return { data: DATA.tracking, error: null }
    return { data: null, error: null }
  }
  q.then = (resolve) => resolve({ data: table === 'borrower_docs' ? DATA.docs : [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t), rpc: (...a) => rpc(...a) } }))

const { default: DocsChecklist } = await import('./DocsChecklist')

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<DocsChecklist contactId="c1" {...props} />))
  await act(async () => {})
  return host
}
const byLabel = (host, label) => host.querySelector(`[aria-label="${label}"]`)

describe('DocsChecklist', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    rpc.mockReset()
    rpc.mockResolvedValue({ data: null, error: null })
    DATA.tracking = { id: 7, notes: 'Sending W2 tomorrow' }
    DATA.docs = [
      { id: 1, doc_type: 'W2', status: 'needed', first_requested_at: new Date(Date.now() - 12 * 86400000).toISOString(), received_at: null, received_by_name: null },
      { id: 2, doc_type: 'ID', status: 'received', first_requested_at: null, received_at: '2026-11-02T16:00:00Z', received_by_name: 'Shelby Atkinson' },
    ]
  })

  it('shows the header, rows, chase tag and note', async () => {
    const host = await mount()
    expect(host.textContent).toContain('1 of 2 needed')
    expect([...host.querySelectorAll('[data-doc]')].map((r) => r.getAttribute('data-doc'))).toEqual(['W2', 'ID'])
    expect(host.querySelector('[data-doc="W2"] [data-chase]')).not.toBe(null)
    expect(host.querySelector('[data-doc="ID"]').textContent).toContain('Nov 2 · Shelby')
    expect(host.querySelector('textarea').value).toBe('Sending W2 tomorrow')
  })

  it('marks a doc received, removes one and adds one', async () => {
    const onChange = vi.fn()
    const host = await mount({ onChange })
    await act(async () => byLabel(host, 'Mark W2 received').click())
    expect(rpc).toHaveBeenCalledWith('set_borrower_doc', { p_contact: 'c1', p_doc_type: 'W2', p_status: 'received' })
    await act(async () => byLabel(host, 'Remove ID').click())
    expect(rpc).toHaveBeenCalledWith('set_borrower_doc', { p_contact: 'c1', p_doc_type: 'ID', p_status: 'removed' })
    const input = host.querySelector('input[aria-label="New doc name"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ' Gift letter ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => byLabel(host, 'Add doc').click())
    expect(rpc).toHaveBeenCalledWith('set_borrower_doc', { p_contact: 'c1', p_doc_type: 'Gift letter', p_status: 'needed' })
    expect(onChange).toHaveBeenCalled()
  })

  it('offers Set up docs on an untracked file', async () => {
    DATA.tracking = null
    DATA.docs = []
    const host = await mount()
    expect(host.textContent).toContain('Docs not set up')
    await act(async () => byLabel(host, 'Set up docs').click())
    expect(rpc).toHaveBeenCalledWith('setup_borrower_docs', { p_contact: 'c1' })
  })

  it('shows the RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Bayway contacts only' } })
    const host = await mount()
    await act(async () => byLabel(host, 'Mark W2 received').click())
    expect(host.textContent).toContain('Bayway contacts only')
  })
})
