// @vitest-environment jsdom
// Daily tracker: copies the day's visits as tab-separated Visits rows, notes
// the copy, and offers just the rows logged since.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { touches: [] }
function query() {
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'lt', 'order']) q[m] = () => q
  q.then = (resolve) => resolve({ data: DATA.touches, error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: DailyTracker } = await import('./DailyTracker')
const { default: Toaster } = await import('./Toaster')

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
})
