// @vitest-environment jsdom
// The sidebar's "+ New" menu: four items, each reports its kind and closes the
// menu; Esc and a click outside close it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: QuickAddMenu } = await import('./QuickAddMenu')

const onPick = vi.fn()

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(React.Fragment, null, React.createElement(QuickAddMenu, { onPick }), React.createElement('p', { id: 'outside' }, 'outside')),
    )
  })
}

const trigger = () => document.querySelector('button[aria-haspopup="menu"]')
const menu = () => document.querySelector('[role="menu"]')
const items = () => [...document.querySelectorAll('[role="menuitem"]')]
const click = async (el) => act(async () => el.click())

beforeEach(() => {
  document.body.innerHTML = ''
  onPick.mockReset()
})

describe('QuickAddMenu', () => {
  it('opens with Log call, Note, Follow-up and Task', async () => {
    await mount()
    expect(trigger().textContent).toContain('New')
    expect(menu()).toBe(null)
    await click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(items().map((b) => b.textContent)).toEqual(['Log call…', 'Note…', 'Follow-up…', 'Task…'])
  })

  it('reports the picked kind and closes', async () => {
    await mount()
    for (const [label, kind] of [['Log call…', 'call'], ['Note…', 'note'], ['Follow-up…', 'followup'], ['Task…', 'task']]) {
      await click(trigger())
      await click(items().find((b) => b.textContent === label))
      expect(onPick).toHaveBeenLastCalledWith(kind)
      expect(menu()).toBe(null)
    }
  })

  it('closes on Escape and on a click outside', async () => {
    await mount()
    await click(trigger())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(menu()).toBe(null)
    await click(trigger())
    await act(async () => document.getElementById('outside').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(menu()).toBe(null)
    expect(onPick).not.toHaveBeenCalled()
  })
})
