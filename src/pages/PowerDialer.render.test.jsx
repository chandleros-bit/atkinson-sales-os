// @vitest-environment jsdom
// Power Dialer phase 2: list cards follow the business switch; a CSV with
// nonstandard headers maps on its own, checks against DNC and saves.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function query() {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => ({ data: null, error: null }) // PageHeader's sync dot
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

let biz = 'all'
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ role: 'owner', session: { user: { id: 'u1' } } }) }))

const data = { lists: [], saved: null, dncAsked: null }
vi.mock('../lib/dialerData', () => ({
  fetchLists: async () => ({ data: data.lists, error: null }),
  fetchDncSet: async (phones) => { data.dncAsked = phones; return new Set(['+18325550199']) },
  saveList: async (args) => { data.saved = args; return { id: 'new-list', error: null } },
}))

const { default: PowerDialer } = await import('./PowerDialer')

const LISTS = [
  { id: 'l1', business_id: 'mpg', temperature: null, name: 'Houston cafes', status: 'active', dialable: 10, worked: 4, confirmed: 2, last_dialed_at: '2026-11-19T15:00:00Z' },
  { id: 'l2', business_id: 'bay', temperature: 'cold', name: 'Katy owners', status: 'active', dialable: 5, worked: 0, confirmed: 0, last_dialed_at: null },
  { id: 'l3', business_id: 'bay', temperature: 'warm', name: 'Old list', status: 'archived', dialable: 1, worked: 1, confirmed: 0, last_dialed_at: null },
]

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<MemoryRouter><PowerDialer /></MemoryRouter>))
  await act(async () => {})
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
async function click(el) { await act(async () => el.click()) }
async function pickFile(host, name, text) {
  const input = host.querySelector('input[aria-label="CSV file"]')
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await act(async () => {})
}

beforeEach(() => {
  document.body.innerHTML = ''
  biz = 'all'
  data.lists = LISTS
  data.saved = null
})

describe('Power Dialer lists', () => {
  it('shows active lists with their counts and hides archived ones', async () => {
    const host = await mount()
    const cards = host.querySelectorAll('[data-list-id]')
    expect([...cards].map((c) => c.dataset.listId)).toEqual(['l1', 'l2'])
    expect(cards[0].querySelector('[data-stat="worked"]').textContent).toBe('4 / 10 worked')
    expect(cards[0].querySelector('[data-stat="confirmed"]').textContent).toBe('2 confirmed')
    expect(cards[1].textContent).toContain('cold')
    expect(cards[1].querySelector('[data-stat="last"]').textContent).toBe('Not dialed yet')
  })
  it('follows the business switch', async () => {
    biz = 'bay'
    const host = await mount()
    expect([...host.querySelectorAll('[data-list-id]')].map((c) => c.dataset.listId)).toEqual(['l2'])
  })
  it('shows an empty state', async () => {
    data.lists = []
    const host = await mount()
    expect(host.textContent).toContain('No call lists yet')
  })
})

describe('Power Dialer upload', () => {
  const CSV = [
    'Owner Name,Business Name,Mobile,Property City,ST,Year Built',
    'Jane Smith,Acme Cafe,832-555-0101,Houston,TX,1999',
    'Bob Jones,Bob Tacos,none,Katy,TX,',
    'Ann Lee,Lee Nails,(832) 555-0101,Houston,TX,',
    'Do Not,DNC Co,832-555-0199,Houston,TX,',
  ].join('\n')

  it('maps, checks and saves an MPG list', async () => {
    biz = 'mpg'
    const host = await mount()
    await click(button(host, 'Upload CSV'))
    expect(button(host, 'Next').disabled).toBe(true)
    await pickFile(host, 'Houston cafes.csv', CSV)
    expect(host.querySelector('input[aria-label="List name"]').value).toBe('Houston cafes')
    await click(button(host, 'Next'))

    // Auto-mapped from nonstandard headers.
    expect(host.querySelector('select[aria-label="Column for Phone"]').value).toBe('Mobile')
    expect(host.querySelector('select[aria-label="Column for Company"]').value).toBe('Business Name')
    expect(host.querySelector('select[aria-label^="Column for Full name"]').value).toBe('Owner Name')
    const rows = host.querySelectorAll('[data-preview-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('(832) 555-0101')
    expect(rows[0].textContent).toContain('Houston, TX')

    await click(button(host, 'Check list'))
    const n = (k) => host.querySelector(`[data-summary="${k}"] .num`).textContent
    expect([n('total'), n('ready'), n('dnc'), n('badPhone'), n('inFileDupes')]).toEqual(['4', '1', '1', '1', '1'])

    await click(button(host, 'Save list'))
    expect(data.saved).toMatchObject({ business: 'mpg', name: 'Houston cafes', filename: 'Houston cafes.csv', scrubbedBy: 'u1' })
    expect(data.saved.leads.map((l) => l.status)).toEqual(['queued', 'invalid_phone', 'dnc'])
    expect(data.saved.leads[0]).toMatchObject({ first_name: 'Jane', last_name: 'Smith', city: 'Houston', extra: { 'Year Built': '1999' } })
    // Back on the Lists screen.
    expect(host.querySelector('section[aria-label="Upload a call list"]')).toBeNull()
  })

  it('makes a Cold Bayway list confirm the DNC Registry scrub', async () => {
    const host = await mount()
    await click(button(host, 'Upload CSV'))
    await click(button(host, 'Bayway'))
    await click(button(host, 'Cold'))
    await pickFile(host, 'katy.csv', CSV)
    expect(button(host, 'Next').disabled).toBe(true)
    const box = host.querySelector('input[type="checkbox"]')
    await click(box)
    expect(button(host, 'Next').disabled).toBe(false)
    await click(button(host, 'Next'))
    await click(button(host, 'Check list'))
    await click(button(host, 'Save list'))
    expect(data.saved).toMatchObject({ business: 'bay', temperature: 'cold' })
  })

  it('requires a phone column', async () => {
    biz = 'mpg'
    const host = await mount()
    await click(button(host, 'Upload CSV'))
    await pickFile(host, 'x.csv', CSV)
    await click(button(host, 'Next'))
    const sel = host.querySelector('select[aria-label="Column for Phone"]')
    await act(async () => {
      sel.value = ''
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button(host, 'Check list'))
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/phone/i)
    expect(host.querySelector('[data-summary]')).toBeNull()
  })
})
