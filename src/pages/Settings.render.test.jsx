// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const upserts = []
let upsertError = null
let loadError = null
let refreshes = 0
vi.mock('../lib/supabase', () => {
  // from(table): settings answers with the saved odds; sync_log (the header's
  // sync dot) has no rows.
  const from = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: table === 'settings' && !loadError ? { value: { temp_odds: { hot: 70 } } } : null,
        error: table === 'settings' ? loadError : null,
      }),
      upsert: async (row) => {
        upserts.push(row)
        return { error: upsertError }
      },
    }
    return q
  }
  return { isDemoMode: false, supabase: { from } }
})
vi.mock('../lib/useForecastInputs', () => ({
  refreshForecastInputs: async () => {
    refreshes += 1
  },
}))

const { default: Settings } = await import('./Settings')

let root
let el
beforeEach(() => {
  upserts.length = 0
  upsertError = null
  loadError = null
  refreshes = 0
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})
afterEach(async () => {
  await act(async () => root.unmount())
  el.remove()
})

const type = (input, value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const saveButton = () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Save odds')

describe('Settings: forecast odds', () => {
  it('loads saved odds over the defaults and saves changes', async () => {
    await act(async () => root.render(<MemoryRouter><Settings /></MemoryRouter>))
    await act(async () => {})
    const hot = el.querySelector('input[aria-label="Hot odds"]')
    const warm = el.querySelector('input[aria-label="Warm odds"]')
    expect(saveButton().disabled).toBe(false)
    expect(hot.value).toBe('70')
    expect(warm.value).toBe('30')
    await type(warm, '35')
    await act(async () => saveButton().click())
    expect(upserts[0]).toMatchObject({ key: 'forecast', value: { temp_odds: { hot: 70, warm: 35, cold: 10 } } })
    expect(refreshes).toBe(1)
    expect(el.textContent).toContain('Saved')
    expect(el.querySelector('a[href="/rate"]')).not.toBe(null)
  })

  it('clamps odds to 100 and keeps the form on a failed save', async () => {
    await act(async () => root.render(<MemoryRouter><Settings /></MemoryRouter>))
    await act(async () => {})
    await type(el.querySelector('input[aria-label="Cold odds"]'), '250')
    upsertError = { message: 'denied' }
    await act(async () => saveButton().click())
    expect(upserts[0].value.temp_odds.cold).toBe(100)
    expect(el.textContent).toContain('Not saved: denied')
    expect(refreshes).toBe(0)
  })

  it('keeps Save disabled after a load error', async () => {
    loadError = { message: 'offline' }
    await act(async () => root.render(<MemoryRouter><Settings /></MemoryRouter>))
    await act(async () => {})
    expect(el.textContent).toContain('Could not load saved odds: offline')
    expect(saveButton().disabled).toBe(true)
    await act(async () => saveButton().click())
    expect(upserts).toHaveLength(0)
  })
})
