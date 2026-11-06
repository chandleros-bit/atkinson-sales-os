// @vitest-environment jsdom
// ZohoPromote runs a promote_prospect on mount, shows Zoho matches to pick
// from, and reports the outcome through toasts and onDone.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: () => ({}), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: ZohoPromote } = await import('./ZohoPromote')
const { default: Toaster } = await import('./Toaster')

const TOUCH = {
  id: 't1', business_name: 'Feges BBQ', temperature: 'warm', notes: 'Liked it',
  follow_up_on: '2026-11-10', next_step: 'Call back',
}
const CANDS = [
  { id: 'z1', company: 'Feges BBQ', name: 'Patrick', phone: '555-111-2222', status: 'Contacted' },
  { id: 'z2', company: 'Feges Barbecue', name: 'Pat', phone: '555-333-4444', status: 'Open' },
]

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'promote', ok: true, lead_id: 'L1', linked: false, contact_id: 'c1' }] }, error: null })
})

async function wait(ms = 50) { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
async function mount(onDone = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(React.Fragment, null,
      React.createElement(ZohoPromote, { prospectId: 'p1', touch: TOUCH, onDone }),
      React.createElement(Toaster)))
  })
  await wait(20)
  return onDone
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
async function click(el) { await act(async () => { el.click() }) }
const reply = (data) => invoke.mockResolvedValueOnce({ data, error: null })

describe('ZohoPromote', () => {
  it('ok: sends one promote request and reports done', async () => {
    const onDone = await mount()
    expect(invoke).toHaveBeenCalledTimes(1)
    const body = invoke.mock.calls[0][1].body
    expect(body).toMatchObject({ action: 'promote_prospect', prospect_id: 'p1', touch_id: 't1' })
    expect(body.payload.note).toContain('Walk-in')
    expect(body.payload.follow_up).toEqual({ due_date: '2026-11-10', title: 'Call back' })
    expect(onDone).toHaveBeenCalledWith({ ok: true, contactId: 'c1' })
    expect(document.body.textContent).toContain('Added to Zoho as Open')
  })

  it('ok with a linked lead says so; a replay is handled the same', async () => {
    reply({ status: 'ok', replay: true, results: [{ step: 'promote', ok: true, lead_id: 'L1', linked: true, contact_id: 'c1' }] })
    const onDone = await mount()
    expect(document.body.textContent).toContain('Linked to Feges BBQ in Zoho')
    expect(onDone).toHaveBeenCalledWith({ ok: true, contactId: 'c1' })
  })

  it('partial: toast with the failing error, still done ok', async () => {
    reply({ status: 'partial', results: [{ step: 'promote', ok: true, contact_id: 'c1' }, { step: 'add_note', ok: false, error: 'note boom' }] })
    const onDone = await mount()
    expect(document.body.textContent).toContain("In Zoho; the note or task didn't save: note boom")
    expect(onDone).toHaveBeenCalledWith({ ok: true })
  })

  it('choose: lists candidates; picking one resends with link_lead_id', async () => {
    reply({ status: 'choose', candidates: CANDS })
    await mount()
    expect(document.body.textContent).toContain('This business may already be in Zoho')
    expect(button('Feges BBQ · Patrick')).toBeTruthy()
    expect(button('Feges Barbecue · Pat')).toBeTruthy()
    await click(button('Feges Barbecue · Pat'))
    await wait()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1][1].body.payload.link_lead_id).toBe('z2')
  })

  it('choose then Create a new lead resends with create_new', async () => {
    reply({ status: 'choose', candidates: CANDS })
    await mount()
    await click(button('Create a new lead'))
    await wait()
    expect(invoke.mock.calls[1][1].body.payload.create_new).toBe(true)
  })

  it('choose then Not now is done not ok', async () => {
    reply({ status: 'choose', candidates: CANDS })
    const onDone = await mount()
    await click(button('Not now'))
    expect(onDone).toHaveBeenCalledWith({ ok: false })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('error: toast with Retry that runs the promotion again', async () => {
    reply({ status: 'error', error: 'Zoho down' })
    const onDone = await mount()
    expect(document.body.textContent).toContain('Not in Zoho yet: Zoho down')
    expect(onDone).toHaveBeenCalledWith({ ok: false })
    await click(button('Retry'))
    await wait()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('refused: error toast with Retry', async () => {
    reply({ status: 'refused', error: 'Turned off' })
    const onDone = await mount()
    expect(document.body.textContent).toContain('Not in Zoho yet: Turned off')
    expect(button('Retry')).toBeTruthy()
    expect(onDone).toHaveBeenCalledWith({ ok: false })
  })

  it('busy: partial toast, no Retry, done not ok', async () => {
    reply({ status: 'busy', error: 'Already adding this business to Zoho' })
    const onDone = await mount()
    expect(document.body.textContent).toContain('Already being added to Zoho — check again in a minute')
    expect(button('Retry')).toBeFalsy()
    expect(onDone).toHaveBeenCalledWith({ ok: false })
  })

  it('refused "Already in Zoho" counts as success', async () => {
    reply({ status: 'refused', error: 'Already in Zoho' })
    const onDone = await mount()
    expect(document.body.textContent).toContain('Already in Zoho')
    expect(button('Retry')).toBeFalsy()
    expect(onDone).toHaveBeenCalledWith({ ok: true })
  })
})
