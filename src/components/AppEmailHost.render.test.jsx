// @vitest-environment jsdom
// The Application Sent email preview: opens after a move to Application Sent
// (not other moves), asks for a missing email, sends send_app_email with the
// picked version, and never opens for a lead already emailed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = {}
function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => ({ data: DATA[table] ?? null, error: null })
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t), functions: { invoke: vi.fn() } } }))
const invokeCrmAction = vi.fn()
vi.mock('../lib/writeback', () => ({
  invokeCrmAction: (...a) => invokeCrmAction(...a),
  useWritebackFlags: () => ({ bay: true, mpg: true }),
}))
const toasts = []
vi.mock('./Toaster', () => ({ showToast: (t) => toasts.push(t) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ role: 'owner' }) }))

const { default: AppEmailHost } = await import('./AppEmailHost')

const roots = []
async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(React.createElement(AppEmailHost)))
  return host
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const moved = async (target = 'application_sent') => {
  window.dispatchEvent(new CustomEvent('crm-action:done', {
    detail: { status: 'ok', results: [{ step: 'set_stage', ok: true }], request: { action: 'set_stage', contact_id: 'c1', payload: { target } } },
  }))
  await flush()
}
const dialog = () => document.querySelector('[role="dialog"]')
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const type = async (el, value) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  DATA.contacts = { id: 'c1', business_id: 'bay', name: 'Jo Ramirez', email: 'jo@x.com', raw: { firstName: 'Jo', tags: ['application sent'] } }
  DATA.lead_emails = null
  DATA.settings = { value: { enabled: true, templates: { first_home: 1, next_home: 2, refinance: 3 } } }
  invokeCrmAction.mockReset()
  toasts.length = 0
})
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()))
  document.body.innerHTML = ''
})

describe('AppEmailHost', () => {
  it('opens the preview after a move to Application Sent', async () => {
    await mount()
    await moved()
    expect(dialog()).not.toBeNull()
    const preview = document.querySelector('[data-app-email-preview]').innerHTML
    expect(preview).toContain('Hey Jo,')
    expect(preview).toContain('buying your first home')
    expect(dialog().textContent).toContain('jo@x.com')
    expect(dialog().textContent).toContain('Your pre-approval: next steps')
  })

  it('does not open for other moves', async () => {
    await mount()
    await moved('estimate_sent')
    expect(dialog()).toBeNull()
  })

  it('asks for an email when the lead has none, and sends it with the picked version', async () => {
    DATA.contacts = { ...DATA.contacts, email: null }
    invokeCrmAction.mockResolvedValue({ status: 'ok', results: [{ step: 'update_person', ok: true }, { step: 'app_email', ok: true }] })
    await mount()
    await moved()
    const input = document.querySelector('input[aria-label="Lead email"]')
    expect(input).not.toBeNull()
    expect(button('Send').disabled).toBe(true)
    await type(input, 'jo@new.com')
    expect(button('Send').disabled).toBe(false)
    await act(async () => button('Refinance').click())
    expect(document.querySelector('[data-app-email-preview]').innerHTML).toContain('refinancing your home')
    await act(async () => button('Send').click())
    await flush()
    expect(invokeCrmAction).toHaveBeenCalledTimes(1)
    expect(invokeCrmAction.mock.calls[0][0]).toMatchObject({ action: 'send_app_email', contact_id: 'c1', payload: { variant: 'refinance', email: 'jo@new.com' } })
    expect(dialog()).toBeNull()
    expect(toasts.at(-1).text).toBe('Application email sent to jo@new.com')
  })

  it('keeps the dialog open with the error when the send fails', async () => {
    invokeCrmAction.mockResolvedValue({ status: 'error', results: [{ step: 'app_email', ok: false, error: 'Application email already sent Nov 5' }] })
    await mount()
    await moved()
    await act(async () => button('Send').click())
    await flush()
    expect(dialog()).not.toBeNull()
    expect(dialog().querySelector('[role="alert"]').textContent).toContain('already sent Nov 5')
  })

  it('toasts instead of opening for a lead already emailed', async () => {
    DATA.lead_emails = { status: 'tagged', tagged_at: '2026-11-05T16:00:00Z', variant: 'first_home' }
    await mount()
    await moved()
    expect(dialog()).toBeNull()
    expect(toasts.at(-1).text).toBe('Application email already sent Nov 5')
  })

  it('stays quiet on a move when the email is off, but says so when asked', async () => {
    DATA.settings = { value: { enabled: false } }
    await mount()
    await moved()
    expect(dialog()).toBeNull()
    expect(toasts).toEqual([])
    window.dispatchEvent(new CustomEvent('app-email:open', { detail: { contactId: 'c1' } }))
    await flush()
    expect(toasts.at(-1).text).toMatch(/application email is off/i)
  })

  it('Skip closes without sending', async () => {
    await mount()
    await moved()
    await act(async () => button('Skip').click())
    expect(dialog()).toBeNull()
    expect(invokeCrmAction).not.toHaveBeenCalled()
  })
})
