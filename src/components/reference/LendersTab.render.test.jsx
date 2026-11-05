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

const { default: LendersTab } = await import('./LendersTab')

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<LendersTab />))
  await act(async () => {})
  return host
}
async function type(el, value) {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const btn = (label) => document.querySelector(`[aria-label="${label}"]`)

describe('LendersTab', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    calls.length = 0
    ROWS = [
      { id: 'l1', lender: 'Acme Non-QM', ae_name: 'Dana Ruiz', ae_phone: '7135550100', ae_email: 'dana@acme.test', portal_url: 'https://acme.test', programs: ['Bank statement', 'DSCR'], min_fico: 620, max_ltv: 80, turn_time: 'UW 48h', comp_notes: '1.5%', notes: null, updated_at: '2026-11-05T15:00:00Z', updated_by_name: 'Shelby Atkinson' },
      { id: 'l2', lender: 'Beta FHA', ae_name: 'Ben', programs: ['FHA'], updated_at: '2026-11-04T15:00:00Z' },
    ]
  })

  it('lists lenders with contact links and who updated them', async () => {
    const host = await mount()
    expect([...host.querySelectorAll('[data-lender]')].map((r) => r.getAttribute('data-lender'))).toEqual(['Acme Non-QM', 'Beta FHA'])
    const acme = host.querySelector('[data-lender="Acme Non-QM"]')
    expect(acme.querySelector('a[href="tel:7135550100"]')).not.toBe(null)
    expect(acme.querySelector('a[href="mailto:dana@acme.test"]')).not.toBe(null)
    expect(acme.textContent).toContain('1.5%')
    expect(acme.textContent).toContain('Updated Nov 5 · Shelby')
  })

  it('filters by search and program', async () => {
    const host = await mount()
    await type(host.querySelector('input[aria-label="Search lenders"]'), 'dana')
    expect(host.querySelectorAll('[data-lender]')).toHaveLength(1)
    await type(host.querySelector('input[aria-label="Search lenders"]'), '')
    await act(async () => btn('Filter FHA').click())
    expect([...host.querySelectorAll('[data-lender]')].map((r) => r.getAttribute('data-lender'))).toEqual(['Beta FHA'])
  })

  it('adds a lender', async () => {
    await mount()
    await act(async () => btn('Add lender').click())
    await type(document.querySelector('input[aria-label="Lender"]'), 'Gamma Bank')
    await type(document.querySelector('input[aria-label="Programs"]'), 'DSCR, ITIN')
    await act(async () => btn('Save lender').click())
    const ins = calls.find((c) => c[0] === 'insert')
    expect(ins[1]).toMatchObject({ lender: 'Gamma Bank', programs: ['DSCR', 'ITIN'] })
  })

  it('deletes after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount()
    await act(async () => btn('Edit Beta FHA').click())
    await act(async () => btn('Delete lender').click())
    expect(calls.some((c) => c[0] === 'delete')).toBe(true)
    expect(calls).toContainEqual(['eq', 'id', 'l2'])
  })
})
