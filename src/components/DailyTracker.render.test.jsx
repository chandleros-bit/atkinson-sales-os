// @vitest-environment jsdom
// Daily tracker: copies the day's visits as tab-separated Visits rows, notes
// the copy, and offers just the rows logged since.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { touches: [], pending: null }
function query() {
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'lt', 'order']) q[m] = () => q
  q.then = (resolve, reject) => {
    if (DATA.pending) return DATA.pending().then(resolve, reject)
    return resolve({ data: DATA.touches, error: null })
  }
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: DailyTracker } = await import('./DailyTracker')
const { default: Toaster } = await import('./Toaster')
const dialogProps = []
vi.mock('./LogVisitDialog', () => ({ default: (props) => { dialogProps.push(props); return React.createElement('div', null, 'EDIT DIALOG') } }))

const touch = (id, business, createdAt) => ({
  id, channel: 'walk_in', occurred_at: '2026-11-05T18:00:00.000Z', created_at: createdAt,
  business_name: business, contact_label: 'Jimmy / Manager', reach_label: '+1 832 474 7707',
  notes: 'line one\nline two', next_step: null, follow_up_on: null, temperature: 'hot',
  dm_conversation: true, statement: false, demo_proposal: false, application: false, boarded: false,
})

let writeText
beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  DATA.pending = null
  dialogProps.length = 0
  DATA.touches = [touch('a', 'NJR Salons', '2026-11-05T18:01:00.000Z')]
  writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(React.Fragment, null,
      React.createElement(DailyTracker, { initialDay: '2026-11-05' }), React.createElement(Toaster)))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))

describe('DailyTracker', () => {
  it('copies the day as Visits rows A–M', async () => {
    await render()
    await act(async () => { button('Copy rows').click() })
    const occurredDay = new Date('2026-11-05T18:00:00.000Z')
    const sheetDay = `${occurredDay.getMonth() + 1}/${occurredDay.getDate()}/${occurredDay.getFullYear()}`
    expect(writeText).toHaveBeenCalledWith(
      [sheetDay, 'NJR Salons', 'Jimmy / Manager', ' +1 832 474 7707', 'line one · line two', '', '', 'Hot', 'Yes', 'No', 'No', 'No', 'No'].join('\t'),
    )
    expect(document.body.textContent).toContain('Copied')
    // "through" is the newest copied row's server created_at; "at" is the click time.
    const saved = JSON.parse(localStorage.getItem('mpg-tracker-copied:2026-11-05:visits'))
    expect(saved.through).toBe('2026-11-05T18:01:00.000Z')
    expect(Math.abs(Date.now() - new Date(saved.at).getTime())).toBeLessThan(60000)
  })

  it('shows the click time, not the newest row time', async () => {
    localStorage.setItem('mpg-tracker-copied:2026-11-05:visits', JSON.stringify({ through: '2026-11-05T18:01:00.000Z', at: '2026-11-05T23:12:00.000Z' }))
    await render()
    const shown = new Date('2026-11-05T23:12:00.000Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    expect(document.body.textContent).toContain(`Copied ${shown}`)
  })

  it('still reads a plain ISO string and hides the time', async () => {
    localStorage.setItem('mpg-tracker-copied:2026-11-05:visits', '2026-11-05T19:00:00.000Z')
    DATA.touches = [touch('a', 'NJR Salons', '2026-11-05T18:01:00.000Z'), touch('b', 'Feges BBQ', '2026-11-05T20:00:00.000Z')]
    await render()
    expect(document.body.textContent).toContain('1 row logged since')
    expect(document.body.textContent).not.toMatch(/Copied \d/)
  })

  it('offers only the rows logged after the copy', async () => {
    localStorage.setItem('mpg-tracker-copied:2026-11-05:visits', '2026-11-05T19:00:00.000Z')
    DATA.touches = [touch('a', 'NJR Salons', '2026-11-05T18:01:00.000Z'), touch('b', 'Feges BBQ', '2026-11-05T20:00:00.000Z')]
    await render()
    expect(document.body.textContent).toContain('1 row logged since')
    await act(async () => { button('Copy new rows only').click() })
    expect(writeText.mock.calls[0][0].split('\n')).toHaveLength(1)
    expect(writeText.mock.calls[0][0]).toContain('Feges BBQ')
  })

  it('says so when the day is empty', async () => {
    DATA.touches = []
    await render()
    expect(document.body.textContent).toContain('No visits logged for this day.')
    expect(button('Copy rows')).toBeUndefined()
  })

  it('shows only the later day when responses resolve out of order', async () => {
    const resolvers = []
    DATA.pending = () => new Promise((res) => resolvers.push(res))
    await render()
    const input = document.querySelector('input[type="date"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, '2026-11-06'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(resolvers).toHaveLength(2)
    await act(async () => { resolvers[1]({ data: [touch('b', 'Feges BBQ', '2026-11-06T18:01:00.000Z')], error: null }) })
    await act(async () => { resolvers[0]({ data: [touch('a', 'NJR Salons', '2026-11-05T18:01:00.000Z')], error: null }) })
    expect(document.body.textContent).toContain('Feges BBQ')
    expect(document.body.textContent).not.toContain('NJR Salons')
  })

  it('clears the old rows at once when the day changes', async () => {
    await render()
    DATA.pending = () => new Promise(() => {})
    const input = document.querySelector('input[type="date"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, '2026-11-06'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(document.body.textContent).not.toContain('NJR Salons')
    expect(button('Copy rows')).toBeUndefined()
  })

  it('ignores an emptied date input', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render()
    const input = document.querySelector('input[type="date"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(document.querySelector('input[type="date"]').value).toBe('2026-11-05')
    expect(document.body.textContent).toContain('NJR Salons')
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('shows an error instead of throwing when the fetch rejects', async () => {
    DATA.pending = () => Promise.reject(new Error('network down'))
    await render()
    expect(document.body.textContent).toContain('network down')
  })

  it('falls back to a textarea and an error toast when the copy is rejected', async () => {
    await render()
    writeText.mockRejectedValue(new Error('denied'))
    await act(async () => { button('Copy rows').click() })
    expect(document.body.textContent).toContain("Couldn't copy")
    const ta = document.querySelector('textarea')
    expect(ta).not.toBeNull()
    expect(ta.value).toContain('NJR Salons')
    expect(localStorage.getItem('mpg-tracker-copied:2026-11-05:visits')).toBeNull()
  })

  it('opens the edit dialog with the clicked row', async () => {
    await render()
    const row = [...document.querySelectorAll('li button')][0]
    await act(async () => { row.click() })
    expect(document.body.textContent).toContain('EDIT DIALOG')
    expect(dialogProps.at(-1).touch.id).toBe('a')
  })
})
