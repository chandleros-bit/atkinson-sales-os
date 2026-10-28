// @vitest-environment jsdom
// The left nav: nine links, each lit on its own pages and on the old per-book
// routes it replaced; Settings carries the sync dot. BookPage: the merged
// Pipeline / Contacts page follows the business switch, with a Bayway | MPG
// toggle on All.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let filter = 'all'
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signOut: () => {}, isDemoMode: false }) }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: filter }) }))
vi.mock('../lib/usePriorityQueue', () => ({ usePriorityQueue: () => ({ queue: [] }) }))
vi.mock('../lib/useSyncHealth', () => ({ useSyncHealth: () => ({ fub: { finished_at: new Date().toISOString(), status: 'ok' } }) }))
vi.mock('../lib/syncHealth', () => ({ syncHealth: () => ({ state: 'ok', text: 'Synced 2m ago', detail: [] }) }))
vi.mock('./SearchPalette', () => ({ openSearch: () => {} }))
vi.mock('./NewMenu', () => ({ default: () => null }))

const { default: Sidebar } = await import('./Sidebar')
const { default: BookPage } = await import('./BookPage')

let host
async function render(ui, path = '/') {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>))
  return host
}
const current = () => [...host.querySelectorAll('nav[aria-label="Main"] a[aria-current="page"]')].map((a) => a.textContent)

beforeEach(() => {
  document.body.innerHTML = ''
  filter = 'all'
  localStorage.clear()
})

describe('Sidebar', () => {
  it('lists nine links in four groups', async () => {
    await render(<Sidebar />)
    const links = [...host.querySelectorAll('nav[aria-label="Main"] a')].map((a) => a.textContent)
    expect(links).toEqual(['Overview', 'Workbench', 'Calendar', 'Tasks', 'Pipeline', 'Contacts', 'Activity', 'Reports', 'Settings'])
    expect(host.querySelector('nav[aria-label="Main"]').textContent).toContain('Books')
    expect(host.querySelector('a[href="/pipeline"]')).not.toBeNull()
    expect(host.querySelector('a[href="/sync"] [data-sync-state="ok"]')).not.toBeNull()
  })

  it.each([
    ['/bayway/pipeline', 'Pipeline'],
    ['/mpg/contacts', 'Contacts'],
    ['/bayway/activity', 'Activity'],
    ['/analytics', 'Reports'],
    ['/sync', 'Settings'],
    ['/bayway/priority-leads', 'Workbench'],
    ['/', 'Overview'],
  ])('lights the merged link on %s', async (path, label) => {
    await render(<Sidebar />, path)
    expect(current()).toEqual([label])
  })
})

describe('BookPage', () => {
  const Page = ({ biz }) => <div data-page>{biz}</div>

  it('follows the business switch with no toggle', async () => {
    filter = 'mpg'
    await render(<BookPage page={Page} />, '/pipeline')
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(host.querySelector('[data-page]').textContent).toBe('mpg')
  })

  it('on All, a Bayway | MPG toggle picks the book and remembers it', async () => {
    await render(<BookPage page={Page} />, '/pipeline')
    expect(host.querySelector('[data-page]').textContent).toBe('bay')
    const mpg = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'MPG')
    await act(async () => mpg.click())
    expect(host.querySelector('[data-page]').textContent).toBe('mpg')
    expect(mpg.getAttribute('aria-selected')).toBe('true')
    expect(localStorage.getItem('book-pick')).toBe('mpg')
  })
})
