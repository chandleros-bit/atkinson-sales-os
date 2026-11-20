// @vitest-environment jsdom
// Edit targets: one column per business in view, saved per business.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/supabase', () => ({ isDemoMode: true, supabase: null }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: 'all' }) }))

const { EditTargets } = await import('./Reports')

async function render(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(EditTargets, { onClose: () => {}, saving: false, savedTargets: {}, ...props }))
  })
  return host
}
const input = (label) => document.querySelector(`input[aria-label="${label}"]`)
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => { document.body.innerHTML = '' })

describe('EditTargets', () => {
  it('shows Bayway and MPG side by side on All, with the combined total', async () => {
    await render({ tab: 'daily', biz: 'all', savedTargets: { by_business: { bay: { calls: 30 }, mpg: { calls: 40 } } } })
    expect(input('Bayway Outbound calls').value).toBe('30')
    expect(input('MPG Outbound calls').value).toBe('40')
    expect(document.body.textContent).toContain('70')
  })

  it('shows only the business in view, and only metrics it carries', async () => {
    await render({ tab: 'weekly', biz: 'mpg' })
    expect(input('MPG Business-owner conversations')).not.toBeNull()
    expect(input('MPG Realtor conversations')).toBeNull()
    expect(input('Bayway Outbound calls')).toBeNull()
  })

  it('saves each business separately', async () => {
    const onSave = vi.fn()
    await render({ tab: 'daily', biz: 'all', onSave })
    await act(async () => { type(input('MPG Outbound calls'), '55') })
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save targets').click() })
    const draft = onSave.mock.calls[0][0]
    expect(draft.mpg.calls).toBe('55')
    expect(draft.bay.calls).toBe(30)
  })
})
