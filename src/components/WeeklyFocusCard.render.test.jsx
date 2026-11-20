// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const updates = []
vi.mock('../lib/weeklyFocus', () => ({
  loadWeeklyFocus: async () => ({
    week: '2026-11-16',
    focus: { id: 'f', title: 'Book 3 applications this week', notes: 'Applications were 0 of 3 last week.', business_id: 'bay' },
    tasks: [
      { id: 't1', title: 'Call the 5 past-client picks every day', status: 'done' },
      { id: 't2', title: 'Follow up on every Application/Estimate Sent', status: 'open', due_on: '2026-11-18' },
    ],
    done: 1, total: 2,
    checkin: { done: 1, total: 2, note: 'Missed the estimate follow-ups.' },
  }),
  setFocusTaskDone: async (id, done) => { updates.push([id, done]); return { status: done ? 'done' : 'open' } },
}))

const { default: WeeklyFocusCard } = await import('./WeeklyFocusCard')

describe('WeeklyFocusCard', () => {
  it('shows the focus, its tasks and the check-in, and checks a task off', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(WeeklyFocusCard))))
    await act(async () => {})
    expect(host.querySelector('[data-focus]').textContent).toBe('Book 3 applications this week')
    expect(host.textContent).toContain('1 of 2 done')
    expect(host.querySelector('[data-checkin]').textContent).toContain('Missed the estimate follow-ups.')
    await act(async () => host.querySelector('[data-focus-task="t2"] input').click())
    expect(updates).toEqual([['t2', true]])
    expect(host.textContent).toContain('2 of 2 done')
  })
})
