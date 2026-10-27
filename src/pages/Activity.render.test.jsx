// @vitest-environment jsdom
// The Activity page: one book's feed, or both books merged under the All filter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { v_bayway_activity: [], v_mpg_activity: [] }
let filter = 'all'

function query(table) {
  let from = 0
  let to = 999
  const q = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.range = (a, b) => {
    from = a
    to = b
    return q
  }
  q.maybeSingle = async () => ({ data: null, error: null })
  q.then = (resolve) => resolve({ data: (DATA[table] || []).slice(from, to + 1), error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t) },
}))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: filter }) }))

const { default: Activity } = await import('./Activity')

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString()
const row = (id, h, name, type = 'call') => ({ id, type, occurred_at: hoursAgo(h), contact_name: name, snippet: '', crm_profile_url: '#' })

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Activity, props)))
  })
  await act(async () => {})
  return host
}
const shown = (host) => [...host.querySelectorAll('[data-activity]')].map((e) => `${e.getAttribute('data-activity')}:${e.textContent.match(/Ana|Bo|Cy|Di/)?.[0]}`)

beforeEach(() => {
  document.body.innerHTML = ''
  filter = 'all'
  DATA.v_bayway_activity = [row(1, 1, 'Ana'), row(2, 5, 'Cy')]
  DATA.v_mpg_activity = [row(1, 2, 'Bo'), row(2, 6, 'Di')]
})

describe('Activity', () => {
  it('merges both books newest first under All, each row badged', async () => {
    const host = await mount()
    expect(shown(host)).toEqual(['bay:Ana', 'mpg:Bo', 'bay:Cy', 'mpg:Di'])
    expect(host.querySelector('[data-activity="mpg"]').textContent).toContain('MPG')
    expect(host.querySelector('header').textContent).toContain('Both books')
  })

  it('follows the business filter', async () => {
    filter = 'mpg'
    const host = await mount()
    expect(shown(host)).toEqual(['mpg:Bo', 'mpg:Di'])
  })

  it("a book's own page ignores the filter", async () => {
    const host = await mount({ biz: 'bay' })
    expect(shown(host)).toEqual(['bay:Ana', 'bay:Cy'])
    // One book, so no book badge on the rows.
    expect(host.querySelector('[data-activity]').textContent).not.toContain('BAYWAY')
  })
})
