// @vitest-environment jsdom
// ForecastCard with a hand-built forecast: the overdue and undated notes.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import ForecastCard from './ForecastCard'

const now = new Date(2026, 10, 15).getTime()
const line = (o) => ({ book: 'bay', source: 'arive', odds: 50, payout: 1000, est: false, funded: false, overdue: false, month: '2026-11', payDate: '2026-11-20', ...o })

async function render(lines, biz = 'bay') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(MemoryRouter, null, React.createElement(ForecastCard, { forecast: { lines, loading: false, error: null }, biz, now })),
    )
  })
  return document.querySelector('[data-card="forecast"]').textContent
}

describe('ForecastCard notes', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('counts past-due Bayway lines on This month', async () => {
    const text = await render([line({ key: 'a', overdue: true, payDate: '2026-10-05' }), line({ key: 'b', overdue: true, payDate: '2026-09-05' }), line({ key: 'c' })])
    expect(text).toContain('· 2 past due')
    expect(text).not.toContain('no closing date')
  })

  it('shows no past-due note when nothing is overdue', async () => {
    expect(await render([line({ key: 'a' })])).not.toContain('past due')
  })

  it('shows the undated line once, singular and plural', async () => {
    const undated = (k) => line({ key: k, month: null, payDate: null })
    expect(await render([undated('a')])).toContain('1 open loan with no closing date')
    document.body.innerHTML = ''
    const text = await render([undated('a'), undated('b')])
    expect(text).toContain('2 open loans with no closing date')
    expect(text.match(/no closing date/g)).toHaveLength(1)
  })
})
