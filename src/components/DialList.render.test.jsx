// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./PersonSheet', () => ({ openPerson: () => {} }))
const { default: DialList } = await import('./DialList')

const NOW = new Date(2026, 9, 28, 12).getTime()
const item = (o) => ({ id: 'a', book: 'bay', kind: 'attempt', step: 3, calls: 2, dueAt: NOW - 1000, label: 'Attempt 3', hint: 'try afternoon', textKey: 'a3', row: { id: 'a', name: 'Sam Golden', phone: '9137135946', lead_source: 'Lendingflow', business_id: 'bay' }, ...o })

async function render(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(React.createElement(DialList, { now: NOW, onDial: () => {}, ...props })))
  return host
}

describe('DialList', () => {
  it('lists due-now and later-today leads with attempt pips, label, time and a call link', async () => {
    const onDial = vi.fn()
    const host = await render({ dueNow: [item()], laterToday: [item({ id: 'b', step: 2, calls: 1, dueAt: NOW + 2.5 * 3600000, label: 'Attempt 2', hint: null, row: { id: 'b', name: 'Dawn Gast', phone: '1', business_id: 'bay' } })], onDial })
    const rows = host.querySelectorAll('[data-dial-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Sam Golden')
    expect(rows[0].textContent).toContain('Attempt 3 · due now · try afternoon')
    expect(rows[0].querySelectorAll('[data-pip="on"]')).toHaveLength(2)
    expect(rows[0].querySelector('a[href="tel:9137135946"]')).not.toBe(null)
    expect(rows[1].textContent).toContain('2:30 PM')
    await act(async () => host.querySelector('[data-start-dialing]').click())
    expect(onDial).toHaveBeenCalledWith(0)
  })
  it('says when nobody is due', async () => {
    const host = await render({ dueNow: [], laterToday: [] })
    expect(host.textContent).toContain('No lead calls due right now')
  })
})
