// @vitest-environment jsdom
// Reports: the Daily tracker tab exists only in the MPG view.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const BIZ = { current: 'mpg' }
vi.mock('../lib/supabase', () => ({ isDemoMode: true, supabase: null }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: BIZ.current }) }))
vi.mock('../components/DailyTracker', () => ({ default: () => React.createElement('div', null, 'TRACKER BODY') }))

const { default: Reports } = await import('./Reports')

async function render(biz) {
  BIZ.current = biz
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => { createRoot(host).render(React.createElement(Reports)) })
  return host
}
const tabLabels = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)

beforeEach(() => { document.body.innerHTML = '' })

describe('Reports tracker tab', () => {
  it('shows on MPG and opens the tracker', async () => {
    await render('mpg')
    expect(tabLabels()).toContain('Daily tracker')
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Daily tracker')
    await act(async () => { tab.click() })
    expect(document.body.textContent).toContain('TRACKER BODY')
    expect(document.body.textContent).not.toContain('Edit targets')
  })
  it.each(['bay', 'all'])('is absent on %s', async (biz) => {
    await render(biz)
    expect(tabLabels()).not.toContain('Daily tracker')
  })
})
