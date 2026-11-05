// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = []
let ROWS = []
function query() {
  const q = {}
  for (const m of ['select', 'order', 'limit']) q[m] = () => q
  q.eq = (k, v) => (calls.push(['eq', k, v]), q)
  q.insert = (v) => (calls.push(['insert', v]), q)
  q.update = (v) => (calls.push(['update', v]), q)
  q.delete = () => (calls.push(['delete']), q)
  q.then = (resolve) => resolve({ data: ROWS, error: null })
  return q
}
vi.mock('../../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: LinksTab } = await import('./LinksTab')

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<LinksTab {...props} />))
  await act(async () => {})
  return host
}
const btn = (label) => document.querySelector(`[aria-label="${label}"]`)
async function set(label, v) {
  const el = document.querySelector(`input[aria-label="${label}"]`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('LinksTab', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    calls.length = 0
    ROWS = [
      { id: 'a', title: 'HAR.com', url: 'https://www.har.com/', grp: 'Property', sort: 1, copy_address: false },
      { id: 'b', title: 'HCAD (Harris)', url: 'https://hcad.org/', grp: 'Property', sort: 3, copy_address: true },
      { id: 'c', title: 'TREC license search', url: 'https://www.trec.texas.gov/license-search', grp: 'Licensing', sort: 2, copy_address: false },
    ]
  })

  it('shows tiles by group, opening in a new tab', async () => {
    const host = await mount()
    expect([...host.querySelectorAll('[data-link-group]')].map((g) => g.getAttribute('data-link-group'))).toEqual(['Property', 'Licensing'])
    const har = host.querySelector('a[data-link="HAR.com"]')
    expect(har.getAttribute('href')).toBe('https://www.har.com/')
    expect(har.getAttribute('target')).toBe('_blank')
  })

  it('address lookup builds search links and lists copy-address sites', async () => {
    const host = await mount({ initialAddress: '3042 Oak Forest Dr, Houston, TX 77018' })
    expect(host.querySelector('a[aria-label="Search HAR"]').getAttribute('href')).toContain('quicksearch=3042%20Oak%20Forest%20Dr')
    expect(host.querySelector('a[aria-label="Search Google Maps"]').getAttribute('href')).toContain('query=3042')
    expect(host.querySelector('a[aria-label="Search Zillow"]').getAttribute('href')).toContain('3042-Oak-Forest-Dr')
    expect(host.querySelector('[data-copy-sites]').textContent).toContain('HCAD (Harris)')
  })

  it('edit mode adds and deletes links', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount()
    await act(async () => btn('Edit links').click())
    await act(async () => btn('Add link').click())
    await set('Title', 'MERS')
    await set('URL', 'https://www.mers-servicerid.org/')
    await set('Group', 'Loan lookups')
    await act(async () => btn('Save link').click())
    expect(calls.find((c) => c[0] === 'insert')[1]).toMatchObject({ title: 'MERS', grp: 'Loan lookups' })
    await act(async () => btn('Delete TREC license search').click())
    expect(calls).toContainEqual(['eq', 'id', 'c'])
  })

  it('refuses a URL without http(s)', async () => {
    await mount()
    await act(async () => btn('Edit links').click())
    await act(async () => btn('Add link').click())
    await set('URL', 'har.com')
    await set('Title', 'HAR')
    await act(async () => btn('Save link').click())
    expect(calls.some((c) => c[0] === 'insert')).toBe(false)
    expect(document.body.textContent).toContain('Start the URL with https://')
  })
})
