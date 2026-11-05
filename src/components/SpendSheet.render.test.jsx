// @vitest-environment jsdom
// Spend sheet: month x source grid, free sources, merges.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
let root
let mounted

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = { biz: 'bay', leads: LEADS, aliases: [], spend: SPEND, onClose, onSaved, nowMs: NOW, ...props }
  await act(async () => {
    root.render(React.createElement(SpendSheet, mounted))
  })
  return host
}
// The parent re-renders the sheet with reloaded aliases/spend after onSaved.
async function rerender(props) {
  mounted = { ...mounted, ...props }
  await act(async () => {
    root.render(React.createElement(SpendSheet, mounted))
  })
}
const tab = (name) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name)
const rowOrder = () => [...document.querySelectorAll('[data-spend-row]')].map((r) => r.getAttribute('data-spend-row'))
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
// Unmount so an earlier sheet's Escape listener can't answer a later test.
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
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
    expect(document.querySelector('[role="dialog"] [role="alert"]').textContent).toBe('Enter a dollar amount for Lendgo, 2026-10.')
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

  it('merging into a free label keeps it free', async () => {
    const aliases = [{ id: 'x1', book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: true }]
    await mount({ aliases })
    await act(async () => input('Merge Chandler').click())
    await act(async () => input('Merge Chandler Atkinson').click())
    await type(input('Merged label'), 'Self-sourced')
    await act(async () => button('Merge sources').click())
    expect(saveAliases).toHaveBeenCalledWith([
      { book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: true },
      { book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: true },
    ])
  })

  describe('edits stay separate from saved spend', () => {
    const REALTOR_LEADS = [
      { id: 'r1', business_id: 'bay', source: 'Realtor', created: new Date(2026, 9, 20).toISOString(), person_stage: 'Lead', tags: [] },
      { id: 'r2', business_id: 'bay', source: 'Realtor Referral', created: new Date(2026, 9, 21).toISOString(), person_stage: 'Lead', tags: [] },
    ]
    const REALTOR_SPEND = [
      { id: 'p1', book: 'bay', source: 'Realtor', month: '2026-10-01', amount: 100 },
      { id: 'p2', book: 'bay', source: 'Realtor Referral', month: '2026-10-01', amount: 50 },
    ]
    const MERGED = [
      { id: 'x1', book: 'bay', raw: 'Realtor', label: 'Realtor Referral', is_free: false },
      { id: 'x2', book: 'bay', raw: 'Realtor Referral', label: 'Realtor Referral', is_free: false },
    ]
    let confirm
    beforeEach(() => {
      confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    })
    afterEach(() => confirm.mockRestore())
    async function pickRealtorMerge() {
      await act(async () => input('Merge Realtor').click())
      await act(async () => input('Merge Realtor Referral').click())
      await type(input('Merged label'), 'Realtor Referral')
    }

    it('an edit typed before a merge is dropped, not saved against the new grid', async () => {
      await mount({ leads: REALTOR_LEADS, spend: REALTOR_SPEND })
      await type(input('Realtor Oct 26'), '120')
      await pickRealtorMerge()
      await act(async () => button('Merge sources').click())
      expect(confirm).toHaveBeenCalledWith('Discard unsaved spend for this book?')
      expect(saveAliases).toHaveBeenCalled()
      await rerender({ aliases: MERGED })
      expect(input('Realtor Referral Oct 26').value).toBe('150')
      await act(async () => button('Save spend').click())
      expect(saveSpend).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('an edit typed before an unmerge is dropped, not saved against the new grid', async () => {
      const spend = [{ id: 'a1', book: 'bay', source: 'A', month: '2026-10-01', amount: 100 }]
      await mount({ spend, aliases: [{ id: 'y1', book: 'bay', raw: 'A', label: 'L', is_free: false }] })
      await type(input('L Oct 26'), '120')
      await act(async () => button('Unmerge L').click())
      expect(confirm).toHaveBeenCalledWith('Discard unsaved spend for this book?')
      expect(removeAliases).toHaveBeenCalledWith(['y1'])
      await rerender({ aliases: [] })
      expect(input('A Oct 26').value).toBe('100')
      await act(async () => button('Save spend').click())
      expect(saveSpend).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('declining the discard keeps the edit and does not merge', async () => {
      confirm.mockReturnValue(false)
      await mount({ leads: REALTOR_LEADS, spend: REALTOR_SPEND })
      await type(input('Realtor Oct 26'), '120')
      await pickRealtorMerge()
      await act(async () => button('Merge sources').click())
      expect(saveAliases).not.toHaveBeenCalled()
      expect(input('Realtor Oct 26').value).toBe('120')
    })

    it('declining the discard keeps the edit and does not unmerge', async () => {
      confirm.mockReturnValue(false)
      const spend = [{ id: 'a1', book: 'bay', source: 'A', month: '2026-10-01', amount: 100 }]
      await mount({ spend, aliases: [{ id: 'y1', book: 'bay', raw: 'A', label: 'L', is_free: false }] })
      await type(input('L Oct 26'), '120')
      await act(async () => button('Unmerge L').click())
      expect(removeAliases).not.toHaveBeenCalled()
      expect(input('L Oct 26').value).toBe('120')
    })

    it('merging asks nothing when the book has no unsaved edits (an edit equal to saved is not one)', async () => {
      await mount({ leads: REALTOR_LEADS, spend: REALTOR_SPEND })
      await type(input('Realtor Oct 26'), '100.00')
      await pickRealtorMerge()
      await act(async () => button('Merge sources').click())
      expect(confirm).not.toHaveBeenCalled()
      expect(saveAliases).toHaveBeenCalled()
    })

    it('after a merge, Save with no edits writes nothing and closes', async () => {
      await mount({ leads: REALTOR_LEADS, spend: REALTOR_SPEND })
      expect(input('Realtor Referral Oct 26').value).toBe('50')
      await act(async () => input('Merge Realtor').click())
      await act(async () => input('Merge Realtor Referral').click())
      await type(input('Merged label'), 'Realtor Referral')
      await act(async () => button('Merge sources').click())
      expect(saveAliases).toHaveBeenCalled()
      await rerender({
        aliases: [
          { id: 'x1', book: 'bay', raw: 'Realtor', label: 'Realtor Referral', is_free: false },
          { id: 'x2', book: 'bay', raw: 'Realtor Referral', label: 'Realtor Referral', is_free: false },
        ],
      })
      expect(input('Realtor Referral Oct 26').value).toBe('150')
      expect(input('Realtor Oct 26')).toBe(null)
      await act(async () => button('Save spend').click())
      expect(saveSpend).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('after an unmerge, Save with no edits writes nothing', async () => {
      const spend = [{ id: 'a1', book: 'bay', source: 'A', month: '2026-10-01', amount: 100 }]
      await mount({ spend, aliases: [{ id: 'y1', book: 'bay', raw: 'A', label: 'L', is_free: false }] })
      expect(input('L Oct 26').value).toBe('100')
      await act(async () => button('Unmerge L').click())
      expect(removeAliases).toHaveBeenCalledWith(['y1'])
      await rerender({ aliases: [] })
      expect(input('A Oct 26').value).toBe('100')
      await act(async () => button('Save spend').click())
      expect(saveSpend).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('on All, Save writes edits from the book not on screen', async () => {
      const spend = [...SPEND, { id: 'm1', book: 'mpg', source: 'Web', month: '2026-11-01', amount: 20 }]
      await mount({ biz: 'all', spend })
      await act(async () => tab('MPG').click())
      await type(input('Web Oct 26'), '40')
      await act(async () => tab('Bayway').click())
      await type(input('Lendgo Oct 26'), '10')
      await act(async () => button('Save spend').click())
      expect(saveSpend).toHaveBeenCalledTimes(1)
      expect(saveSpend).toHaveBeenCalledWith({
        upserts: [
          { book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: 10 },
          { book: 'mpg', source: 'Web', month: '2026-10-01', amount: 40 },
        ],
        deletes: [],
      })
    })

    it('on All, a bad amount in the other book names the book and saves nothing', async () => {
      const spend = [...SPEND, { id: 'm1', book: 'mpg', source: 'Web', month: '2026-11-01', amount: 20 }]
      await mount({ biz: 'all', spend })
      await act(async () => tab('MPG').click())
      await type(input('Web Oct 26'), 'abc')
      await act(async () => tab('Bayway').click())
      await act(async () => button('Save spend').click())
      expect(saveSpend).not.toHaveBeenCalled()
      expect(document.querySelector('[role="alert"]').textContent).toBe('MPG: Enter a dollar amount for Web, 2026-10.')
    })
  })

  it('locks the grid inputs and book tabs while a save is running', async () => {
    saveSpend.mockReturnValue(new Promise(() => {}))
    await mount({ biz: 'all' })
    expect(input('Lendgo Oct 26').disabled).toBe(false)
    expect(tab('MPG').disabled).toBe(false)
    await type(input('Lendgo Oct 26'), '450')
    await act(async () => button('Save spend').click())
    expect(input('Lendgo Oct 26').disabled).toBe(true)
    expect(tab('MPG').disabled).toBe(true)
    expect(tab('Bayway').disabled).toBe(true)
  })

  it('a failed reload after Save keeps the sheet open and says so', async () => {
    onSaved.mockResolvedValue({ error: { message: 'reload failed' } })
    await mount()
    await type(input('Lendgo Oct 26'), '450')
    await act(async () => button('Save spend').click())
    expect(saveSpend).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"] [role="alert"]').textContent).toBe("Saved, but couldn't reload: reload failed")
    expect(button('Save spend').disabled).toBe(false)
  })

  it('a failed reload after Free shows in the sheet', async () => {
    onSaved.mockResolvedValue({ error: { message: 'reload failed' } })
    await mount()
    await act(async () => input('Free Lendgo').click())
    expect(saveAliases).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"] [role="alert"]').textContent).toBe("Saved, but couldn't reload: reload failed")
  })

  it('a thrown save shows the problem and frees the buttons', async () => {
    saveAliases.mockRejectedValue(new Error('network down'))
    await mount()
    await act(async () => input('Free Lendgo').click())
    expect(document.querySelector('[role="alert"]').textContent).toBe('network down')
    expect(button('Save spend').disabled).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
  })

  describe('closing', () => {
    let confirm
    beforeEach(() => {
      confirm = vi.spyOn(window, 'confirm')
    })
    afterEach(() => confirm.mockRestore())

    it('closes straight away with no edits', async () => {
      confirm.mockReturnValue(false)
      await mount()
      await act(async () => button('Close').click())
      expect(confirm).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('asks before discarding unsaved edits', async () => {
      confirm.mockReturnValue(false)
      await mount()
      await type(input('Lendgo Oct 26'), '450')
      await act(async () => button('Close').click())
      expect(confirm).toHaveBeenCalledWith('Discard unsaved spend?')
      expect(onClose).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ignores close while a save is running', async () => {
      confirm.mockReturnValue(true)
      saveSpend.mockReturnValue(new Promise(() => {}))
      await mount()
      await type(input('Lendgo Oct 26'), '450')
      await act(async () => button('Save spend').click())
      expect(button('Save spend').disabled).toBe(true)
      await act(async () => button('Close').click())
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      await act(async () => document.querySelector('[role="dialog"]').parentElement.click())
      expect(onClose).not.toHaveBeenCalled()
      expect(confirm).not.toHaveBeenCalled()
    })
  })

  it('free sources keep their inputs, ticked, after paid rows under a Free sources heading', async () => {
    const aliases = [{ id: 'f1', book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }]
    await mount({ aliases })
    expect(rowOrder()).toEqual(['Chandler', 'Chandler Atkinson', 'Lendgo'])
    const lendgo = document.querySelector('[data-spend-row="Lendgo"]')
    expect(lendgo.previousElementSibling.textContent).toBe('Free sources')
    expect(input('Free Lendgo').checked).toBe(true)
    expect(input('Free Chandler').checked).toBe(false)
    expect(input('Lendgo Nov 26').value).toBe('300')
    await type(input('Lendgo Nov 26'), '')
    await act(async () => button('Save spend').click())
    expect(saveSpend).toHaveBeenCalledWith({ upserts: [], deletes: ['s1'] })
  })

  it('unticking a free source marks it paid', async () => {
    const aliases = [{ id: 'f1', book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }]
    await mount({ aliases })
    await act(async () => input('Free Lendgo').click())
    expect(saveAliases).toHaveBeenCalledWith([{ book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: false }])
  })
})
