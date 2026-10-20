// @vitest-environment jsdom
// Global search against a fake Supabase: the shortcuts, the debounce and
// 2-character minimum, grouped results, keyboard choice, stale responses,
// page jumps, and the person sheet for a person or a task's contact.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const rpc = vi.fn()
const DATA = { tasks: [], people: {}, board: {} }

function query(table) {
  const q = {}
  let id = null
  for (const m of ['select', 'order', 'limit', 'or', 'gte', 'gt', 'lte', 'range']) q[m] = () => q
  q.eq = (c, v) => {
    if (c === 'id') id = v
    return q
  }
  q.maybeSingle = async () => {
    if (table === 'settings') return { data: { value: { bay: true, mpg: true } }, error: null }
    if (table === 'v_people') return { data: DATA.people[id] ?? null, error: null }
    if (table === 'v_active_pipeline' || table === 'v_mpg_contacts') return { data: DATA.board[id] ?? null, error: null }
    return { data: null, error: null }
  }
  q.then = (resolve) => resolve({ data: table === 'v_tasks' ? DATA.tasks : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), rpc: (...a) => rpc(...a), functions: { invoke: vi.fn() } },
}))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: 'all', matches: () => true }) }))

const { default: SearchPalette, openSearch } = await import('./SearchPalette')
const { resetWritebackFlags } = await import('../lib/writeback')
const { default: Toaster } = await import('./Toaster')

function Where() {
  return React.createElement('div', { 'data-where': true }, useLocation().pathname)
}

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement('button', { id: 'opener' }, 'opener'),
        React.createElement('input', { id: 'other-field' }),
        React.createElement(SearchPalette),
        React.createElement(Where),
        React.createElement(Toaster),
      ),
    )
  })
  return host
}

const input = () => document.querySelector('input[aria-label="Search people, tasks and pages"]')
const palette = () => document.querySelector('[role="dialog"][aria-label="Search"]')
const key = async (el, k, extra = {}) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
  })
const type = async (value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
const settle = (ms = 220) => act(async () => new Promise((r) => setTimeout(r, ms)))
const ok = (data) => Promise.resolve({ data, error: null })

const jo = { id: 'c1', business_id: 'bay', name: 'Jo Ramirez', company: null, phone: '7135550142', email: null, stage: 'New Lead', on_board: true, crm_profile_url: 'https://fub/1' }
const kim = { id: 'c2', business_id: 'mpg', name: 'Jo Kim', company: 'Kim Deli', phone: null, email: 'jo@deli.test', stage: 'Open', on_board: true, crm_profile_url: 'https://zoho/2' }

beforeEach(() => {
  document.body.innerHTML = ''
  rpc.mockReset()
  rpc.mockImplementation(() => ok([]))
  DATA.tasks = []
  DATA.people = {}
  DATA.board = {}
  resetWritebackFlags()
})

describe('SearchPalette', () => {
  it('opens on Ctrl+K and on "/" outside a text field, with the input focused', async () => {
    await mount()
    await key(document.getElementById('other-field'), '/')
    expect(palette()).toBe(null)
    await key(document.body, 'k', { ctrlKey: true })
    expect(palette()).not.toBe(null)
    expect(document.activeElement).toBe(input())
    await key(input(), 'Escape')
    expect(palette()).toBe(null)
    await key(document.body, '/')
    expect(palette()).not.toBe(null)
  })

  it('opens from openSearch() (the sidebar and phone search buttons)', async () => {
    await mount()
    await act(async () => openSearch())
    expect(palette()).not.toBe(null)
  })

  it('waits for two characters and the debounce, then searches once', async () => {
    rpc.mockImplementation(() => ok([jo, kim]))
    DATA.tasks = [{ id: 't1', title: 'Send terms', contact_id: 'c1', contact_name: 'Jo Ramirez', business_id: 'bay', due_at: '2026-10-13T00:00:00Z' }]
    await mount()
    await act(async () => openSearch())
    await type('j')
    await settle()
    expect(rpc).not.toHaveBeenCalled()
    await type('jo')
    await settle()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('search_people', { q: 'jo', prefer: null, max_rows: 8 })
    const text = palette().textContent
    expect(text).toContain('People')
    expect(text).toContain('Jo Ramirez')
    expect(text).toContain('Jo Kim')
    expect(text).toContain('Open tasks')
    expect(text).toContain('Send terms')
    expect(text).toContain('BAYWAY')
  })

  it('ignores a slow answer to an older query', async () => {
    let first
    rpc
      .mockImplementationOnce(() => new Promise((r) => { first = r }))
      .mockImplementationOnce(() => ok([kim]))
    await mount()
    await act(async () => openSearch())
    await type('jo')
    await settle()
    await type('jo k')
    await settle()
    await act(async () => first({ data: [jo], error: null }))
    expect(palette().textContent).toContain('Jo Kim')
    expect(palette().textContent).not.toContain('Jo Ramirez')
  })

  it('picks with the arrow keys and Enter, and opens the person sheet', async () => {
    rpc.mockImplementation(() => ok([jo, kim]))
    DATA.board.c2 = { id: 'c2', stage: 'Open', open_task_count: 0, oldest_open_due_at: null, stage_since: null, crm_created_at: null, last_outbound_call_at: null }
    await mount()
    await act(async () => openSearch())
    await type('jo')
    await settle()
    await key(input(), 'ArrowDown')
    await key(input(), 'Enter')
    expect(palette()).toBe(null)
    const sheet = document.querySelector('[role="dialog"][aria-label="Jo Kim"]')
    expect(sheet.textContent).toContain('MPG · Open')
    expect(sheet.textContent).toContain('jo@deli.test')
    expect(sheet.textContent).toContain('No next step')
    expect(sheet.textContent).toContain('Open in Zoho')
    expect(sheet.querySelector('[aria-label="Log call"]')).not.toBe(null)
  })

  it('opens the person sheet for a task\'s contact', async () => {
    DATA.tasks = [{ id: 't1', title: 'Send terms', contact_id: 'c9', contact_name: 'Jonathan Bang', business_id: 'bay', due_at: '2026-10-13T00:00:00Z' }]
    DATA.people.c9 = { id: 'c9', business_id: 'bay', name: 'Jonathan Bang', company: null, phone: '2815550100', email: null, stage: 'Attempted', on_board: true, crm_profile_url: 'https://fub/9' }
    DATA.board.c9 = { id: 'c9', stage: 'Attempted', open_task_count: 1, oldest_open_due_at: '2026-10-13T00:00:00Z', stage_since: null, crm_created_at: null, last_outbound_call_at: null }
    await mount()
    await act(async () => openSearch())
    await type('send')
    await settle()
    await act(async () => document.querySelector('[data-result="t:t1"]').click())
    await act(async () => {})
    const sheet = document.querySelector('[role="dialog"][aria-label="Jonathan Bang"]')
    expect(sheet.textContent).toContain('Bayway · Attempted')
    expect(sheet.textContent).toContain('overdue')
    expect(sheet.textContent).toContain('Open in FollowUpBoss')
  })

  it('jumps to a page', async () => {
    await mount()
    await act(async () => openSearch())
    await type('reports')
    await settle()
    await key(input(), 'Enter')
    expect(document.querySelector('[data-where]').textContent).toBe('/reports')
    expect(palette()).toBe(null)
  })

  it('returns focus to what was focused before it opened', async () => {
    await mount()
    document.getElementById('opener').focus()
    await key(document.body, 'k', { metaKey: true })
    await key(input(), 'Escape')
    expect(document.activeElement).toBe(document.getElementById('opener'))
  })
})

describe('SearchPalette: pick a person for an action', () => {
  const noPhone = { ...jo, id: 'c3', name: 'Jo Nophone', phone: null }

  it('asks who, lists people only, then opens that action for them', async () => {
    rpc.mockImplementation(() => ok([jo]))
    DATA.tasks = [{ id: 't1', title: 'Jo follow-up', contact_id: 'c1', contact_name: 'Jo Ramirez', business_id: 'bay', due_at: null }]
    await mount()
    await act(async () => openSearch({ pick: 'note' }))
    expect(input().getAttribute('placeholder')).toBe('Who is this for?')
    expect(palette().textContent).toContain('Add note')
    await type('jo')
    await settle()
    expect(palette().textContent).toContain('Jo Ramirez')
    expect(palette().textContent).not.toContain('Open tasks')
    expect(palette().textContent).not.toContain('Go to')
    await key(input(), 'Enter')
    const sheet = document.querySelector('[role="dialog"][aria-label="Add note"]')
    expect(sheet.textContent).toContain('Jo Ramirez · FollowUpBoss')
    await act(async () => sheet.querySelector('[aria-label="Close"]').click())
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('will not log a call for a Bayway lead with no phone', async () => {
    rpc.mockImplementation(() => ok([noPhone]))
    await mount()
    await act(async () => openSearch({ pick: 'call' }))
    await type('jo')
    await settle()
    await key(input(), 'Enter')
    expect(document.querySelector('[role="dialog"][aria-label="Log call"]')).toBe(null)
    expect(document.body.textContent).toContain('No phone on file in FUB')
  })

  it('opens Schedule follow-up for the picked person', async () => {
    rpc.mockImplementation(() => ok([kim]))
    await mount()
    await act(async () => openSearch({ pick: 'followup' }))
    await type('jo')
    await settle()
    await key(input(), 'Enter')
    expect(document.querySelector('[role="dialog"][aria-label="Schedule follow-up"]').textContent).toContain('Jo Kim · Zoho')
  })
})
