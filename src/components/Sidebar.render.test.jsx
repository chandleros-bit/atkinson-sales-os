// @vitest-environment jsdom
// The left nav: ten links, each lit on its own pages and on the old per-book
// routes it replaced; Settings carries the sync dot. BookPage: the merged
// Pipeline / Contacts page shows the book the business switch picked, with no
// toggle of its own.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let filter = 'all'
let book = 'bay'
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: null }))
let auth = { role: 'owner' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signOut: () => {}, isDemoMode: false, ...auth }) }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: filter, book }) }))
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
  book = 'bay'
  auth = { role: 'owner' }
  localStorage.clear()
})

describe('Sidebar', () => {
  it('shows the assistant Workbench, Tasks, Pipeline and Reference only, with her name and role', async () => {
    auth = { role: 'assistant', userName: 'Shelby Atkinson' }
    await render(<Sidebar />)
    const links = [...host.querySelectorAll('nav[aria-label="Main"] a')].map((a) => a.textContent)
    expect(links).toEqual(['Workbench', 'Tasks', 'Pipeline', 'Reference'])
    expect(host.textContent).toContain('Shelby Atkinson')
    expect(host.textContent).toContain('Assistant')
    expect(host.textContent).not.toContain('Super Admin')
  })

  it('shows the owner as Chandler, Super Admin', async () => {
    await render(<Sidebar />)
    expect(host.textContent).toContain('Chandler Atkinson')
    expect(host.textContent).toContain('Super Admin')
  })

  it('lists eleven links in four groups', async () => {
    await render(<Sidebar />)
    const links = [...host.querySelectorAll('nav[aria-label="Main"] a')].map((a) => a.textContent)
    expect(links).toEqual(['Overview', 'Workbench', 'Calendar', 'Tasks', 'Pipeline', 'Loans', 'Contacts', 'Activity', 'Reports', 'Reference', 'Settings'])
    expect(host.querySelector('nav[aria-label="Main"]').textContent).toContain('Books')
    expect(host.querySelector('a[href="/pipeline"]')).not.toBeNull()
    // Settings opens the Settings tab (forecast odds, Rate leads); Sync status is its sibling tab.
    expect(host.querySelector('a[href="/settings"] [data-sync-state="ok"]')).not.toBeNull()
  })

  it.each([
    ['/bayway/pipeline', 'Pipeline'],
    ['/mpg/contacts', 'Contacts'],
    ['/bayway/activity', 'Activity'],
    ['/analytics', 'Reports'],
    ['/sync', 'Settings'],
    ['/settings', 'Settings'],
    ['/rate', 'Settings'],
    ['/bayway/priority-leads', 'Workbench'],
    ['/', 'Overview'],
  ])('lights the merged link on %s', async (path, label) => {
    await render(<Sidebar />, path)
    expect(current()).toEqual([label])
  })
})

describe('BookPage', () => {
  const Page = ({ biz }) => <div data-page>{biz}</div>

  it('shows the picked book and has no toggle of its own', async () => {
    book = 'mpg'
    await render(<BookPage page={Page} />, '/pipeline')
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(host.querySelector('[data-page]').textContent).toBe('mpg')
  })
})
