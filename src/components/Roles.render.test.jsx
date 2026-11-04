// @vitest-environment jsdom
// The assistant login (spec 2026-11-03, section 3): Quick Actions and + New
// offer her only what crm-action lets her do.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let authValue = { role: 'assistant', isDemoMode: false }
vi.mock('../context/AuthContext', () => ({ useAuth: () => authValue }))

const flags = { bay: true, mpg: true }
function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lt', 'order', 'limit', 'range']) q[m] = () => q
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { ...flags } } : null, error: null })
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: async () => ({ data: { status: 'ok' }, error: null }) } },
}))

const { default: QuickActions } = await import('./QuickActions')
const { resetWritebackFlags } = await import('../lib/writeback')
const { default: QuickAddMenu } = await import('./QuickAddMenu')

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(el))
  await act(async () => {})
  return host
}
const labels = (host) => [...host.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label'))

describe('assistant gating', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetWritebackFlags()
  })
  it('QuickActions offers the assistant note, follow-up and complete only', async () => {
    authValue = { role: 'assistant', isDemoMode: false }
    const host = await mount(<QuickActions businessId="bay" contactId="c1" contactName="Pat" stage="Contacted/Working" task={{ id: 't1' }} />)
    const l = labels(host)
    expect(l).toContain('Add note')
    expect(l).toContain('Schedule follow-up')
    expect(l).toContain('Complete task')
    expect(l).not.toContain('Move stage')
    expect(l).not.toContain('Push task')
    expect(l).not.toContain('Log call')
  })
  it('QuickActions still offers the owner everything', async () => {
    authValue = { role: 'owner', isDemoMode: false }
    const host = await mount(<QuickActions businessId="bay" contactId="c1" contactName="Pat" stage="Contacted/Working" task={{ id: 't1' }} />)
    expect(labels(host)).toContain('Move stage')
    expect(labels(host)).toContain('Log call')
  })
  it('QuickActions ignores an autoOpen the assistant cannot use', async () => {
    authValue = { role: 'assistant', isDemoMode: false }
    const host = await mount(<QuickActions businessId="bay" contactId="c1" contactName="Pat" autoOpen="call" />)
    expect(document.body.textContent).not.toMatch(/Log call/)
    expect(labels(host)).toContain('Add note')
  })
  it('QuickAddMenu hides kinds it is told to', async () => {
    const host = await mount(<QuickAddMenu onPick={() => {}} hide={['call']} />)
    await act(async () => host.querySelector('button[aria-haspopup="menu"]').click())
    expect(host.textContent).not.toContain('Log call')
    expect(host.textContent).toContain('Note')
  })
})
