// @vitest-environment jsdom
// Ready to Push: exact fields per row, edit, approve one or many, skip, retry.
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
let biz = 'all'
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ role: 'owner' }) }))

const db = {}
vi.mock('../lib/dialerData', () => ({
  fetchQueue: async () => ({ data: structuredClone(db.rows), error: null }),
  saveQueueEdits: async (id, fields) => { db.edits.push({ id, fields }); return { error: null } },
  skipQueueRows: async (ids) => { db.skipped.push(...ids); return { error: null } },
  approveQueueRows: async (ids) => { db.approved.push(ids); return { results: ids.map((id) => db.result(id)), error: null } },
}))

const { default: PushQueue } = await import('./PushQueue')

const row = (id, business, outcome, lead, extra = {}) => ({
  id, business_id: business, target: business === 'mpg' ? 'zoho' : 'fub', outcome, status: 'pending', payload: {}, error: null,
  dialer_leads: {
    phone_e164: '+17135550101', crm_match: null, dialer_lists: { name: 'List A', temperature: business === 'bay' ? 'cold' : null },
    dialer_calls: [{ outcome, notes: 'Wants a call back', dialed_at: '2026-11-20T20:15:00Z' }], ...lead,
  },
  ...extra,
})

beforeEach(() => {
  document.body.innerHTML = ''
  biz = 'all'
  db.edits = []
  db.skipped = []
  db.approved = []
  db.result = (id) => ({ id, status: 'pushed', crm_record_id: '99' })
  db.rows = [
    row('q1', 'mpg', 'interested', { first_name: 'Jane', last_name: 'Smith', company: 'Acme Cafe' }),
    row('q2', 'bay', 'application_sent', { first_name: 'Bo', last_name: 'Lee', phone_e164: '+17135550102' }),
    row('q3', 'bay', 'interested', { phone_e164: '+17135550103' }), // no name: can't be pushed
  ]
})

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<MemoryRouter><PushQueue /></MemoryRouter>))
  await act(async () => {})
  return host
}
const rowEl = (host, id) => host.querySelector(`[data-row-id="${id}"]`)
const btn = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
async function click(el) { await act(async () => el.click()) }
const previewText = (el) => [...el.querySelectorAll('[data-preview] > div')].map((d) => `${d.children[0].textContent}=${d.children[1].textContent}`)

describe('Ready to Push', () => {
  it('shows the exact Zoho and FUB fields that will be written', async () => {
    const host = await mount()
    expect(previewText(rowEl(host, 'q1'))).toEqual(expect.arrayContaining([
      'Last_Name=Smith', 'Company=Acme Cafe', 'Lead_Status=Open', 'Lead_Source=Chandler', 'MPG_REP=Chandler', 'Tag=Power Dialer',
    ]))
    expect(previewText(rowEl(host, 'q2'))).toEqual(expect.arrayContaining([
      'Source=CA Power Dialer', 'Tags=CA, CA Power Dialer, Cold, application sent',
    ]))
    expect(rowEl(host, 'q1').textContent).toContain('Wants a call back')
  })

  it('follows the business switch', async () => {
    biz = 'mpg'
    const host = await mount()
    expect([...host.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId)).toEqual(['q1'])
  })

  it('blocks a row that cannot be written until it is edited', async () => {
    const host = await mount()
    const el = rowEl(host, 'q3')
    expect(el.textContent).toMatch(/needs a name/)
    expect(btn(el, 'Approve').disabled).toBe(true)
    await click(btn(el, 'Edit'))
    const input = el.querySelector('input[aria-label="First name"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Cy')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(btn(el, 'Save fields'))
    expect(db.edits).toEqual([{ id: 'q3', fields: { first_name: 'Cy' } }])
    expect(btn(rowEl(host, 'q3'), 'Approve').disabled).toBe(false)
  })

  it('approves one row and drops it from the queue', async () => {
    const host = await mount()
    await click(btn(rowEl(host, 'q1'), 'Approve'))
    expect(db.approved).toEqual([['q1']])
    expect(rowEl(host, 'q1')).toBeNull()
    expect(host.querySelector('[data-done]').textContent).toBe('1 pushed.')
  })

  it('keeps a failed row with its error and offers Retry', async () => {
    db.result = (id) => ({ id, status: 'failed', error: 'FUB POST /people -> 401' })
    const host = await mount()
    await click(btn(rowEl(host, 'q2'), 'Approve'))
    const el = rowEl(host, 'q2')
    expect(el.querySelector('[data-failed]').textContent).toBe('Push failed: FUB POST /people -> 401')
    expect(btn(el, 'Retry')).toBeTruthy()
  })

  it('selects all pushable rows and approves them together', async () => {
    const host = await mount()
    await click(host.querySelector('input[aria-label="Select all"]'))
    await click(btn(host, 'Approve selected'))
    expect(db.approved).toEqual([['q1', 'q2']])
  })

  it('skips a row, keeping the lead in Sales OS only', async () => {
    const host = await mount()
    await click(btn(rowEl(host, 'q1'), 'Skip'))
    expect(db.skipped).toEqual(['q1'])
    expect(rowEl(host, 'q1')).toBeNull()
  })
})
