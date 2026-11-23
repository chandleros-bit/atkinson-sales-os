// @vitest-environment jsdom
// Drafts: lists waiting drafts, marks an edit, approves with the edited text,
// and skips with a reason.
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = { approve: [], skip: [] }
const DRAFTS = [
  { id: 'd1', bot: 'cold_email', draft_type: 'email', to_name: 'Laura Hughes', to_email: 'laura@compass.com', contact_id: null, subject: 'Class on the 14th', body: 'Hi Laura, want to join?', original_subject: 'Class on the 14th', original_body: 'Hi Laura, want to join?', business_id: 'bay' },
  { id: 'd2', bot: 'gbp', draft_type: 'gbp_post', subject: null, body: 'Rates moved this week.', original_subject: null, original_body: 'Rates moved this week.', business_id: 'bay' },
]

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: {} }))
vi.mock('../components/PersonSheet', () => ({ openPerson: () => {} }))
vi.mock('../lib/drafts', async (orig) => {
  const real = await orig()
  return {
    ...real,
    loadDrafts: async () => DRAFTS,
    approveDraft: async (d, text) => { calls.approve.push([d.id, text]); return { ok: true, patch: { status: 'approved' }, url: null } },
    skipDraft: async (d, reason) => { calls.skip.push([d.id, reason]); return { status: 'skipped' } },
  }
})

const { default: Drafts } = await import('./Drafts')

const setValue = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

describe('Drafts', () => {
  it('approves an edited draft and skips another with a reason', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Drafts))))
    await act(async () => {})
    expect(host.querySelectorAll('[data-draft]')).toHaveLength(2)
    expect(host.querySelector('[data-draft="d1"] [data-approve]').textContent).toBe('Approve and open in Outlook')

    const body = host.querySelector('[data-draft="d1"] textarea')
    await act(async () => setValue(body, 'Hi Laura, want to join my class?'))
    expect(host.querySelector('[data-draft="d1"] [data-edited]')).toBeTruthy()
    await act(async () => host.querySelector('[data-draft="d1"] [data-approve]').click())
    expect(calls.approve).toEqual([['d1', { subject: 'Class on the 14th', body: 'Hi Laura, want to join my class?' }]])
    expect(host.querySelector('[data-draft="d1"]')).toBeNull()

    await act(async () => host.querySelector('[data-draft="d2"] [data-skip]').click())
    await act(async () => setValue(host.querySelector('[data-draft="d2"] select'), 'too salesy'))
    await act(async () => host.querySelector('[data-draft="d2"] [data-skip-confirm]').click())
    expect(calls.skip).toEqual([['d2', 'too salesy']])
    expect(host.textContent).toContain('Nothing waiting')
  })
})
