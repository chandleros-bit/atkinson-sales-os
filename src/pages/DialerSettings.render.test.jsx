// @vitest-environment jsdom
// Power Dialer settings: per-business script, templates, retry rule, hours
// guard (Bayway), and the shared DNC list.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function query() {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: 'all' }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ role: 'owner' }) }))

const db = {}
vi.mock('../lib/dialerData', () => ({
  fetchScripts: async () => ({ data: structuredClone(db.scripts), error: null }),
  saveScript: async (business, fields) => { db.saved.push({ business, fields }); return { error: null } },
  fetchDnc: async (q) => ({ data: db.dnc.filter((r) => r.phone_e164.includes(String(q).replace(/\D/g, ''))), error: null }),
  addDnc: async (phone, reason) => { db.added.push({ phone, reason }); return { error: null } },
  removeDnc: async (phone) => { db.removed.push(phone); return { error: null } },
}))

const { default: DialerSettings } = await import('./DialerSettings')

beforeEach(() => {
  document.body.innerHTML = ''
  db.saved = []
  db.added = []
  db.removed = []
  db.scripts = {
    mpg: { business_id: 'mpg', body: '# MPG', sms_template: 'Hi {first_name}', email_subject: 's', email_body: 'b', max_attempts: 3, min_retry_hours: 4, hours_guard: true },
    bay: { business_id: 'bay', body: '# Bay', sms_template: '', email_subject: '', email_body: '', max_attempts: 3, min_retry_hours: 4, hours_guard: true },
  }
  db.dnc = [{ phone_e164: '+17135550199', reason: 'Asked', source: 'dialer', added_at: '2026-11-20T15:00:00Z' }]
})

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<MemoryRouter><DialerSettings /></MemoryRouter>))
  await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
  return host
}
const btn = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
async function click(el) { await act(async () => el.click()) }
async function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Dialer settings', () => {
  it('edits and saves the MPG script and templates', async () => {
    const host = await mount()
    expect(host.querySelector('textarea[aria-label="Call script"]').value).toBe('# MPG')
    expect(host.querySelector('input[aria-label="Calling hours guard"]')).toBeNull() // Bayway only
    await type(host.querySelector('textarea[aria-label="Text template"]'), 'Hi {first_name}, thanks!')
    await type(host.querySelector('input[aria-label="Hours between attempts"]'), '6')
    await click(btn(host, 'Save settings'))
    expect(db.saved[0].business).toBe('mpg')
    expect(db.saved[0].fields).toMatchObject({ sms_template: 'Hi {first_name}, thanks!', min_retry_hours: 6, max_attempts: 3 })
    expect(host.querySelector('[data-saved]').textContent).toBe('Saved.')
  })

  it('switches to Bayway, with the calling hours guard', async () => {
    const host = await mount()
    await click(btn(host, 'Bayway'))
    expect(host.querySelector('textarea[aria-label="Call script"]').value).toBe('# Bay')
    const guard = host.querySelector('input[aria-label="Calling hours guard"]')
    expect(guard.checked).toBe(true)
    await click(guard)
    await click(btn(host, 'Save settings'))
    expect(db.saved[0]).toMatchObject({ business: 'bay', fields: { hours_guard: false } })
  })

  it('refuses more than 3 attempts', async () => {
    const host = await mount()
    await type(host.querySelector('input[aria-label="Max attempts"]'), '4')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/1 to 3/)
    expect(btn(host, 'Save settings').disabled).toBe(true)
  })

  it('adds, searches and removes Do Not Call numbers', async () => {
    const host = await mount()
    expect(host.querySelector('[data-dnc="+17135550199"]').textContent).toContain('(713) 555-0199')
    await type(host.querySelector('input[aria-label="Number to block"]'), '(832) 555-0123')
    await type(host.querySelector('input[aria-label="Reason"]'), 'Hung up angry')
    await click(btn(host, 'Add'))
    expect(db.added).toEqual([{ phone: '+18325550123', reason: 'Hung up angry' }])
    expect(host.querySelector('[data-dnc="+18325550123"]')).not.toBeNull()
    await click(host.querySelector('[data-dnc="+17135550199"] button'))
    expect(db.removed).toEqual(['+17135550199'])
    expect(host.querySelector('[data-dnc="+17135550199"]')).toBeNull()
  })

  it('rejects a number that is not a phone', async () => {
    const host = await mount()
    await type(host.querySelector('input[aria-label="Number to block"]'), '555')
    await click(btn(host, 'Add'))
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/not a valid phone/)
    expect(db.added).toEqual([])
  })
})
