// @vitest-environment jsdom
// Reference page: tabs in the URL, calculators update as you type (spec 2026-11-05).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function query() {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete']) q[m] = () => q
  q.maybeSingle = async () => ({ data: null, error: null }) // PageHeader's sync dot
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: Reference } = await import('./Reference')

async function mount(url) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () =>
    createRoot(host).render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/reference" element={<Reference />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
  await act(async () => {})
  return host
}
async function type(host, label, value) {
  const input = host.querySelector(`input[aria-label="${label}"]`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const out = (host, key) => host.querySelector(`[data-out="${key}"]`)?.textContent

describe('Reference', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opens on the bank statement calculator and computes income', async () => {
    const host = await mount('/reference')
    expect(host.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Calculators')
    for (let i = 0; i < 12; i++) await type(host, `Deposits month ${i + 1}`, '40000')
    expect(out(host, 'average')).toBe('$40,000')
    expect(out(host, 'income')).toBe('$20,000')
  })

  it('loan payment shows principal and interest', async () => {
    const host = await mount('/reference?calc=payment')
    await type(host, 'Price', '500000')
    await type(host, 'Rate %', '7')
    expect(out(host, 'pi')).toBe('$2,661.21')
    expect(out(host, 'loan')).toBe('$400,000')
  })

  it('DSCR shows the ratio once rent is in', async () => {
    const host = await mount('/reference?calc=dscr')
    await type(host, 'Price', '300000')
    await type(host, 'Rate %', '7.5')
    await type(host, 'Monthly rent', '2500')
    expect(out(host, 'ratio')).toMatch(/^\d\.\d\d$/)
  })

  it('TRID dates from the application date', async () => {
    const host = await mount('/reference?calc=trid')
    await type(host, 'Application date', '2026-11-23')
    expect(out(host, 'leBy')).toBe('Fri, Nov 27, 2026')
  })

  it('tab comes from the URL', async () => {
    const host = await mount('/reference?tab=links')
    expect(host.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Links')
  })
})
