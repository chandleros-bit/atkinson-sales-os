// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./PersonSheet', () => ({ openPerson: () => {} }))
const { default: ThemeList } = await import('./ThemeList')

const week = [
  { day: 1, key: 'new_realtor', label: 'New realtors', count: 2, isToday: true },
  { day: 2, key: 'loan_status', label: 'Loan status', count: 1, isToday: false },
  { day: 3, key: 'past_client', label: 'Past clients', count: 0, isToday: false },
  { day: 4, key: 'pre_approved', label: 'Pre-approved', count: 0, isToday: false },
  { day: 5, key: 'top_partner', label: 'Top partners', count: 1, isToday: false },
]
const item = { id: 'r1', book: 'bay', kind: 'new_realtor', dueAt: 0, label: 'New realtor · intro call', hint: 'never called', row: { id: 'r1', name: 'Rita Realtor', phone: '7135550142' } }

async function render(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(React.createElement(ThemeList, { onDial: () => {}, onPickDay: () => {}, ...props })))
  return host
}

describe('ThemeList', () => {
  it("shows the week strip and today's list with call links; Start dialing opens the dialer", async () => {
    const onDial = vi.fn()
    const onPickDay = vi.fn()
    const host = await render({ list: { theme: week[0], items: [item], total: 2, week }, onDial, onPickDay })
    const days = [...host.querySelectorAll('[data-theme-day]')]
    expect(days.map((d) => d.textContent)).toEqual(['MonNew realtors2 due', 'TueLoan status1 due', 'WedPast clients0 due', 'ThuPre-approved0 due', 'FriTop partners1 due'])
    expect(days[0].getAttribute('aria-current')).toBe('date')
    const row = host.querySelector('[data-theme-row]')
    expect(row.textContent).toContain('Rita Realtor')
    expect(row.textContent).toContain('New realtor · intro call · never called')
    expect(row.querySelector('a[href="tel:7135550142"]')).not.toBe(null)
    expect(host.textContent).toContain('1 more due')
    await act(async () => host.querySelector('[data-theme-start]').click())
    expect(onDial).toHaveBeenCalledWith(0)
    await act(async () => days[4].click())
    expect(onPickDay).toHaveBeenCalledWith(5)
  })
  it('says so on a weekend and when nobody is due', async () => {
    expect((await render({ list: { theme: null, items: [], total: 0, week } })).textContent).toContain('No theme list on weekends')
    expect((await render({ list: { theme: week[2], items: [], total: 0, week } })).textContent).toContain('Nobody due on Past clients')
  })
})
