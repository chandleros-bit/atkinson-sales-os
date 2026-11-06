// @vitest-environment jsdom
// The + New menu's "Log visit…": offered on the MPG and All views, never on
// Bayway, never for the assistant login.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let filter = 'mpg'
let auth = { role: 'owner' }

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: () => {
      const q = {}
      for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
      q.maybeSingle = async () => ({ data: null, error: null })
      q.then = (resolve) => resolve({ data: [], error: null })
      return q
    },
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: filter }) }))
vi.mock('./SearchPalette', () => ({ openSearch: () => {} }))
vi.mock('./PersonSheet', () => ({ default: () => null }))
vi.mock('./NewTaskDialog', () => ({ default: () => null }))
vi.mock('./NewLeadDialog', () => ({ default: () => null }))
vi.mock('./LogVisitDialog', () => ({ default: () => React.createElement('div', { 'data-visit-dialog': true }) }))

const { default: NewMenu } = await import('./NewMenu')

async function open() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(NewMenu))
  })
  await act(async () => {})
  await act(async () => document.querySelector('button[aria-haspopup="menu"]').click())
}
const labels = () => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)

beforeEach(() => {
  document.body.innerHTML = ''
  filter = 'mpg'
  auth = { role: 'owner' }
})

describe('NewMenu: Log visit…', () => {
  it('is offered on the MPG view and opens the dialog', async () => {
    await open()
    expect(labels()).toContain('Log visit…')
    await act(async () => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Log visit…').click())
    expect(document.querySelector('[data-visit-dialog]')).not.toBe(null)
  })

  it('is offered on the All view', async () => {
    filter = 'all'
    await open()
    expect(labels()).toContain('Log visit…')
  })

  it('is not offered on the Bayway view', async () => {
    filter = 'bay'
    await open()
    expect(labels()).not.toContain('Log visit…')
  })

  it('is not offered to the assistant, who also has no Log call', async () => {
    auth = { role: 'assistant' }
    await open()
    expect(labels()).not.toContain('Log visit…')
    expect(labels()).not.toContain('Log call…')
  })
})
