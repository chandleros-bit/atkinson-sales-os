// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const saved = []
let nextResult = { ok: true }
const toasts = []
vi.mock('../components/Toaster', () => ({ showToast: (t) => toasts.push(t) }))
vi.mock('../lib/usePriorityQueue', () => ({
  usePriorityQueue: () => ({
    signals: [
      { id: 'a', business_id: 'bay', name: 'Ann Active', stage: 'Contacted/Working', is_active: true, is_hot: true, last_outbound_call_at: '2026-10-30T10:00:00Z' },
      { id: 'b', business_id: 'mpg', name: 'Bo Called', stage: 'Open', is_active: true, is_hot: false, last_outbound_call_at: '2026-10-29T10:00:00Z' },
      { id: 'c', business_id: 'bay', name: 'Cy Never', stage: 'New Lead', is_active: true, last_outbound_call_at: null },
      { id: 'd', business_id: 'bay', name: 'Di Rated', stage: 'Open', is_active: true, last_outbound_call_at: '2026-10-28T10:00:00Z' },
    ],
    loading: false,
    error: null,
  }),
}))
const ratingMap = new Map([['d', { temperature: 'warm' }]])
vi.mock('../lib/useLeadRatings', () => ({
  useLeadRatings: () => ratingMap,
  useLeadRatingsStatus: () => ({ loading: false, error: null }),
  saveRating: async (r) => {
    saved.push(r)
    return nextResult
  },
}))

const { default: RateLeads } = await import('./RateLeads')

let root
let el
beforeEach(() => {
  saved.length = 0
  toasts.length = 0
  nextResult = { ok: true }
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})

// Unmount so a finished test's window key listener doesn't answer the next one.
afterEach(async () => {
  await act(async () => root.unmount())
  el.remove()
})

const key = (k, init = {}, target = window) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })))
const mount = () => act(async () => root.render(<MemoryRouter><RateLeads /></MemoryRouter>))

describe('Rate leads', () => {
  it('walks called, unrated leads by keyboard, suggesting Hot from the hot flag', async () => {
    await mount()
    expect(el.textContent).toContain('1 of 2')
    expect(el.textContent).toContain('Ann Active')
    expect(el.textContent).toContain('Suggested: Hot')
    await key('Enter')
    expect(saved[0]).toMatchObject({ contactId: 'a', businessId: 'bay', temperature: 'hot' })
    // existing est amount / close month are left alone
    expect('estAmount' in saved[0]).toBe(false)
    expect('closeMonth' in saved[0]).toBe(false)
    expect(el.textContent).toContain('Bo Called')
    await key('c')
    expect(saved[1]).toMatchObject({ contactId: 'b', temperature: 'cold' })
    expect(el.textContent).toContain('All rated')
    expect(el.textContent).not.toContain('Cy Never')
    expect(el.textContent).not.toContain('Di Rated')
  })

  it('skips with S without saving', async () => {
    await mount()
    await key('s')
    expect(saved).toHaveLength(0)
    expect(el.textContent).toContain('Bo Called')
  })

  it('ignores keys typed in a field and keys with a modifier held', async () => {
    await mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    await key('h', {}, input)
    await key('h', { ctrlKey: true })
    await key('w', { metaKey: true })
    await key('c', { altKey: true })
    expect(saved).toHaveLength(0)
    expect(el.textContent).toContain('Ann Active')
    input.remove()
  })

  it('toasts when the save or the FUB tag fails, and still advances', async () => {
    await mount()
    nextResult = { ok: false, error: 'boom' }
    await key('h')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ tone: 'error' })
    expect(el.textContent).toContain('Bo Called')
    nextResult = { ok: true, tagError: 'FUB down' }
    await key('w')
    expect(toasts).toHaveLength(2)
    expect(toasts[1].text).toContain('FUB')
    expect(el.textContent).toContain('All rated')
  })
})
