// @vitest-environment jsdom
// New lead form: required fields per book, the duplicate check before any
// write, the create request, and handing the new contact back.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const rpc = vi.fn()
const invoke = vi.fn()

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: () => ({}), rpc: (...a) => rpc(...a), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: NewLeadDialog } = await import('./NewLeadDialog')
const { default: Toaster } = await import('./Toaster')

const onClose = vi.fn()
const onCreated = vi.fn()
const onOpen = vi.fn()

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(NewLeadDialog, { books: ['bay', 'mpg'], defaultBook: 'bay', onClose, onCreated, onOpen, ...props }),
        React.createElement(Toaster),
      ),
    )
  })
}

const field = (label) => document.querySelector(`[aria-label="${label}"]`)
const button = (text) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === text)
const type = async (label, value) =>
  act(async () => {
    const el = field(label)
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const settle = (ms = 400) => act(async () => new Promise((r) => setTimeout(r, ms)))

beforeEach(() => {
  document.body.innerHTML = ''
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null })
  invoke.mockReset()
  onClose.mockReset()
  onCreated.mockReset()
  onOpen.mockReset()
})

describe('NewLeadDialog', () => {
  it('needs a name and a phone or email for Bayway, and a company for MPG', async () => {
    await mount()
    expect(field('Company')).toBe(null)
    expect(button('Create lead').disabled).toBe(true)
    await type('First name', 'Sam')
    expect(button('Create lead').disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Add a phone or an email')
    await type('Phone', '713 555 0100')
    expect(button('Create lead').disabled).toBe(false)
    await act(async () => button('MPG').click())
    expect(field('Company')).not.toBe(null)
    expect(button('Create lead').disabled).toBe(true)
    await type('Last name', 'Lee')
    await type('Company', 'Lee Deli')
    expect(button('Create lead').disabled).toBe(false)
  })

  it('finds a lead with the same phone before creating another', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'c1', business_id: 'bay', name: 'Jo Ramirez', phone: '(713) 555-0142', email: null }],
      error: null,
    })
    await mount()
    await type('First name', 'Jo')
    await type('Phone', '713-555-0142')
    await settle()
    expect(rpc).toHaveBeenCalledWith('search_people', { q: '7135550142', prefer: 'bay', max_rows: 5 })
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Already in FollowUpBoss: Jo Ramirez')
    expect(button('Create anyway')).toBeTruthy()
    await act(async () => button('Open').click())
    expect(onOpen).toHaveBeenCalledWith('c1')
  })

  it('ignores a match in the other book or on a different number', async () => {
    rpc.mockResolvedValue({
      data: [
        { id: 'c2', business_id: 'mpg', name: 'Jo Kim', phone: '7135550142', email: null },
        { id: 'c3', business_id: 'bay', name: 'Jo Other', phone: '7135550199', email: null },
      ],
      error: null,
    })
    await mount()
    await type('First name', 'Jo')
    await type('Phone', '713-555-0142')
    await settle()
    expect(document.querySelector('[role="dialog"]').textContent).not.toContain('Already in')
    expect(button('Create lead')).toBeTruthy()
  })

  it('creates the lead and hands back the new contact', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'create_contact', ok: true, contact_id: 'c-new' }] }, error: null })
    await mount()
    await type('First name', 'Sam')
    await type('Last name', 'Lee')
    await type('Email', 'sam@example.com')
    await type('Note', 'Met at open house')
    await act(async () => button('Create lead').click())
    const [name, { body }] = invoke.mock.calls[0]
    expect(name).toBe('crm-action')
    expect(body).toMatchObject({
      action: 'create_contact',
      business_id: 'bay',
      payload: { first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', note: 'Met at open house' },
    })
    expect(onCreated).toHaveBeenCalledWith('c-new')
    expect(document.body.textContent).toContain('Lead created in FollowUpBoss')
  })

  it('keeps the form and explains when the CRM says no', async () => {
    invoke.mockResolvedValue({ data: { status: 'error', results: [{ step: 'create_contact', ok: false, error: 'Already in FollowUpBoss as Sam Lee, assigned to another agent' }] }, error: null })
    await mount()
    await type('First name', 'Sam')
    await type('Phone', '713')
    await act(async () => button('Create lead').click())
    expect(document.querySelector('[role="alert"]').textContent).toContain('assigned to another agent')
    expect(onCreated).not.toHaveBeenCalled()
    expect(field('First name').value).toBe('Sam')
  })
})
