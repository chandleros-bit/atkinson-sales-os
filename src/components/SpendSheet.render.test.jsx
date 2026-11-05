// @vitest-environment jsdom
// Spend sheet: month x source grid, free sources, merges.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const saveSpend = vi.fn()
const saveAliases = vi.fn()
const removeAliases = vi.fn()
vi.mock('../lib/roiData', () => ({
  saveSpend: (...a) => saveSpend(...a),
  saveAliases: (...a) => saveAliases(...a),
  removeAliases: (...a) => removeAliases(...a),
}))

const { default: SpendSheet } = await import('./SpendSheet')

const NOW = new Date(2026, 10, 5, 10).getTime()
const LEADS = [
  { id: 'a', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 9, 20).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'b', business_id: 'bay', source: 'Chandler', created: new Date(2026, 9, 21).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'c', business_id: 'bay', source: 'Chandler Atkinson', created: new Date(2026, 9, 22).toISOString(), person_stage: 'Lead', tags: [] },
]
const SPEND = [{ id: 's1', book: 'bay', source: 'Lendgo', month: '2026-11-01', amount: 300 }]
let onSaved
let onClose

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(SpendSheet, { biz: 'bay', leads: LEADS, aliases: [], spend: SPEND, onClose, onSaved, nowMs: NOW, ...props }),
    )
  })
  return host
}
const input = (label) => document.querySelector(`input[aria-label="${label}"]`)
const button = (label) => document.querySelector(`button[aria-label="${label}"]`)
async function type(el, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  saveSpend.mockReset().mockResolvedValue({ error: null })
  saveAliases.mockReset().mockResolvedValue({ error: null })
  removeAliases.mockReset().mockResolvedValue({ error: null })
  onSaved = vi.fn().mockResolvedValue(undefined)
  onClose = vi.fn()
})

describe('SpendSheet', () => {
  it('shows a row per source and a column per month, with saved amounts', async () => {
    await mount()
    expect(document.querySelector('[role="dialog"][aria-label="Marketing spend"]')).not.toBe(null)
    expect(input('Lendgo Nov 26').value).toBe('300')
    expect(input('Chandler Oct 26').value).toBe('')
    expect(document.querySelectorAll('[data-spend-row]')).toHaveLength(3)
  })

  it('saves edited and cleared cells, then reloads and closes', async () => {
    await mount()
    await type(input('Lendgo Oct 26'), '450')
    await type(input('Lendgo Nov 26'), '')
    await act(async () => button('Save spend').click())
    expect(saveSpend).toHaveBeenCalledWith({ upserts: [{ book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: 450 }], deletes: ['s1'] })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the sheet open with the message when a save fails', async () => {
    saveSpend.mockResolvedValue({ error: { message: 'permission denied' } })
    await mount()
    await type(input('Lendgo Oct 26'), '450')
    await act(async () => button('Save spend').click())
    expect(document.querySelector('[role="dialog"]').textContent).toContain('permission denied')
    expect(onClose).not.toHaveBeenCalled()
    expect(input('Lendgo Oct 26').value).toBe('450')
  })

  it('refuses a non-number amount without saving', async () => {
    await mount()
    await type(input('Lendgo Oct 26'), 'abc')
    await act(async () => button('Save spend').click())
    expect(saveSpend).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Enter a dollar amount for Lendgo, 2026-10.')
  })

  it('merges picked sources under one label', async () => {
    await mount()
    await act(async () => input('Merge Chandler').click())
    await act(async () => input('Merge Chandler Atkinson').click())
    await type(input('Merged label'), 'Self-sourced')
    await act(async () => button('Merge sources').click())
    expect(saveAliases).toHaveBeenCalledWith([
      { book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: false },
      { book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: false },
    ])
    expect(onSaved).toHaveBeenCalled()
  })

  it('marks a source free', async () => {
    await mount()
    await act(async () => input('Free Lendgo').click())
    expect(saveAliases).toHaveBeenCalledWith([{ book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }])
  })

  it('shows spend saved under a merged raw source on its label row, summed, and re-saves it under the label', async () => {
    const aliases = [{ id: 'x1', book: 'bay', raw: 'Lendgo', label: 'Lendgo Ads', is_free: false }]
    const spend = [...SPEND, { id: 's2', book: 'bay', source: 'Lendgo Ads', month: '2026-11-01', amount: '50.00' }]
    await mount({ aliases, spend })
    expect(document.querySelector('[data-spend-row="Lendgo"]')).toBe(null)
    expect(input('Lendgo Ads Nov 26').value).toBe('350')
    await type(input('Lendgo Ads Nov 26'), '400')
    await act(async () => button('Save spend').click())
    expect(saveSpend).toHaveBeenCalledWith({ upserts: [{ book: 'bay', source: 'Lendgo Ads', month: '2026-11-01', amount: 400 }], deletes: ['s1'] })
  })

  it('unmerges a merged label', async () => {
    const aliases = [
      { id: 'x1', book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: false },
      { id: 'x2', book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: false },
    ]
    await mount({ aliases })
    await act(async () => button('Unmerge Self-sourced').click())
    expect(removeAliases).toHaveBeenCalledWith(['x1', 'x2'])
  })
})
