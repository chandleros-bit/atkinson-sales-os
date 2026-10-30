// @vitest-environment jsdom
// Loans page in demo mode (no Supabase): the sample loans fill the three
// panels and the table, and import stays off. A separate file because
// vi.mock('../lib/supabase') is per file.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/supabase', () => ({ isDemoMode: true, supabase: null }))

beforeEach(() => {
  document.body.innerHTML = ''
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

const { default: Loans } = await import('./Loans')

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Loans)))
  })
  await act(async () => {})
  return host
}

describe('Loans page in demo mode', () => {
  it('renders the panels and the table from the sample loans', async () => {
    const host = await render()
    expect(host.textContent).toContain('Demo mode')
    expect(host.querySelector('[data-panel="pipeline-status"]')).not.toBeNull()
    expect(host.querySelector('[data-panel="lender-spread"]')).not.toBeNull()
    expect(host.querySelector('[data-panel="loans-funded"]').textContent).toContain('1 Loan Funded')
    expect([...host.querySelectorAll('tbody tr[data-loan]')].map((r) => r.getAttribute('data-loan')).sort()).toEqual(['d1', 'd2', 'd3'])
    expect(host.textContent).toContain('Sample Borrower')
    expect(host.textContent).toContain('Demo Refi')
    expect(host.textContent).toContain('Example Funded')
    const importBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Import CSV')
    expect(importBtn.disabled).toBe(true)
  })

  it('changes a scenario toggle locally without saving', async () => {
    const host = await render()
    await act(async () => host.querySelector('[data-loan="d1"] input[name="scenario"]').click())
    // Now a scenario file, so hidden until scenarios are included.
    expect(host.querySelector('[data-loan="d1"]')).toBeNull()
    await act(async () => host.querySelector('input[name="scenarios"]').click())
    expect(host.querySelector('[data-loan="d1"] input[name="scenario"]').checked).toBe(true)
  })
})
