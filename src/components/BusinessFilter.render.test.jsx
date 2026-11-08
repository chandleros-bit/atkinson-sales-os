// @vitest-environment jsdom
// The one business switch: All / MPG / Bayway everywhere it applies, and
// MPG | Bayway (no All) on the one-book pages, where picking sets the switch.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ role: 'owner' }) }))

const { BusinessProvider, useBusiness } = await import('../context/BusinessContext')
const { default: BusinessFilter } = await import('./BusinessFilter')

let host, seen
function Probe() {
  seen = useBusiness()
  return null
}
async function render(props) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () =>
    createRoot(host).render(
      <BusinessProvider>
        <BusinessFilter {...props} />
        <Probe />
      </BusinessProvider>,
    ),
  )
}
const tabs = () => [...host.querySelectorAll('[role="tab"]')]
const tab = (label) => tabs().find((t) => t.textContent === label)

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('BusinessFilter', () => {
  it('offers All, MPG and Bayway, in that order', async () => {
    await render({})
    expect(tabs().map((t) => t.textContent)).toEqual(['All', 'MPG', 'Bayway'])
    expect(tab('All').getAttribute('aria-selected')).toBe('true')
  })

  it('on a one-book page offers MPG | Bayway and falls back to the remembered book on All', async () => {
    localStorage.setItem('book-pick', 'mpg')
    await render({ books: true })
    expect(tabs().map((t) => t.textContent)).toEqual(['MPG', 'Bayway'])
    expect(tab('MPG').getAttribute('aria-selected')).toBe('true')
    expect(seen.biz).toBe('all')
  })

  it('picking a book sets the one switch and remembers the book', async () => {
    await render({ books: true })
    await act(async () => tab('MPG').click())
    expect(seen.biz).toBe('mpg')
    expect(seen.book).toBe('mpg')
    expect(localStorage.getItem('book-pick')).toBe('mpg')
  })
})
