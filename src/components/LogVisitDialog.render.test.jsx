// @vitest-environment jsdom
// Log visit: a new business saves a prospect then a walk-in touch; a Zoho
// contact's visit also writes a Zoho note (and a task when a follow-up date is
// set); a bad form saves nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const inserted = []
const updated = []
const state = { failTouches: 0 }
const DATA = { contacts: [], prospects: [], writeback: { bay: true, mpg: true } }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'neq', 'or', 'ilike', 'gte', 'lt', 'order', 'limit']) q[m] = () => q
  q.insert = (row) => {
    inserted.push({ table, row })
    if (table === 'mpg_touches' && state.failTouches > 0) {
      state.failTouches -= 1
      return { select: () => ({ single: async () => ({ data: null, error: { message: 'touch insert failed' } }) }) }
    }
    const id = table === 'mpg_prospects' ? 'p-new' : 't-new'
    return { select: () => ({ single: async () => ({ data: { id, ...row }, error: null }) }) }
  }
  q.update = (patch) => {
    updated.push(patch)
    return q
  }
  q.single = async () => ({ data: { id: 't1' }, error: null })
  q.maybeSingle = async () => (table === 'settings' ? { data: { value: DATA.writeback }, error: null } : { data: null, error: null })
  q.then = (resolve) => resolve({
    data: table === 'contacts' ? DATA.contacts : table === 'mpg_prospects' ? DATA.prospects : [],
    error: null,
  })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: LogVisitDialog } = await import('./LogVisitDialog')
const { default: Toaster } = await import('./Toaster')
const { resetWritebackFlags } = await import('../lib/writeback')

beforeEach(() => {
  document.body.innerHTML = ''
  inserted.length = 0
  updated.length = 0
  state.failTouches = 0
  DATA.contacts = []
  DATA.prospects = []
  DATA.writeback = { bay: true, mpg: true }
  resetWritebackFlags()
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'add_note', ok: true }] }, error: null })
})

async function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(React.Fragment, null, el, React.createElement(Toaster)))
  })
  return host
}

const byLabel = (text) => [...document.querySelectorAll('label')].find((l) => l.textContent.includes(text))?.control
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))

async function type(el, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(el) {
  await act(async () => { el.click() })
}
async function wait(ms = 300) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

describe('LogVisitDialog', () => {
  it('saves a new business as a prospect, then the walk-in touch', async () => {
    const onClose = vi.fn()
    await render(React.createElement(LogVisitDialog, { onClose }))
    await type(byLabel('Business'), 'Feges BBQ')
    await wait()
    await click(button('Add new business'))
    await type(byLabel('Contact name'), 'Patrick')
    await click(button('Warm'))
    await click(byLabel('Decision-maker conversation'))
    await click(button('Save visit'))
    await wait(50)

    expect(inserted.map((i) => i.table)).toEqual(['mpg_prospects', 'mpg_touches'])
    expect(inserted[0].row.business_name).toBe('Feges BBQ')
    expect(inserted[1].row).toMatchObject({
      channel: 'walk_in', prospect_id: 'p-new', business_name: 'Feges BBQ',
      contact_label: 'Patrick', temperature: 'warm', dm_conversation: true,
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a Zoho contact visit writes a Zoho note and a follow-up task', async () => {
    await render(React.createElement(LogVisitDialog, {
      onClose: () => {},
      preset: { type: 'contact', id: 'c1', name: 'NJR Salons', phone: '832-474-7707', contactName: 'Jimmy' },
    }))
    await type(byLabel('Notes'), 'Wants a rate review')
    await type(byLabel('Follow-up date'), '2026-12-01')
    await click(button('Save visit'))
    await wait(50)

    expect(inserted.map((i) => i.table)).toEqual(['mpg_touches'])
    expect(inserted[0].row.contact_id).toBe('c1')
    const actions = invoke.mock.calls.map((c) => c[1].body.action)
    expect(actions).toEqual(['add_note', 'create_task'])
    expect(invoke.mock.calls[0][1].body.payload.body).toBe('Walk-in — Wants a rate review')
  })

  it('skips the Zoho note when MPG write-back is off', async () => {
    DATA.writeback = { bay: true, mpg: false }
    await render(React.createElement(LogVisitDialog, {
      onClose: () => {},
      preset: { type: 'contact', id: 'c1', name: 'NJR Salons' },
    }))
    await click(button('Save visit'))
    await wait(50)
    expect(inserted).toHaveLength(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows the problem and saves nothing without a business', async () => {
    await render(React.createElement(LogVisitDialog, { onClose: () => {} }))
    await click(button('Save visit'))
    await wait(50)
    expect(inserted).toHaveLength(0)
    expect(document.body.textContent).toContain('Pick or type the business')
  })

  it('Retry resends only the failed Zoho task, not the note', async () => {
    invoke.mockReset()
    invoke.mockResolvedValueOnce({ data: { status: 'ok' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'error', error: 'boom' }, error: null })
    invoke.mockResolvedValue({ data: { status: 'ok' }, error: null })
    await render(React.createElement(LogVisitDialog, {
      onClose: () => {},
      preset: { type: 'contact', id: 'c1', name: 'NJR Salons' },
    }))
    await type(byLabel('Follow-up date'), '2026-12-01')
    await click(button('Save visit'))
    await wait(50)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('boom')
    await click(button('Retry'))
    await wait(50)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls[2][1].body.action).toBe('create_task')
  })

  it('a retried Save after a failed touch insert reuses the inserted prospect', async () => {
    state.failTouches = 1
    await render(React.createElement(LogVisitDialog, { onClose: () => {} }))
    await type(byLabel('Business'), 'Feges BBQ')
    await wait()
    await click(button('Add new business'))
    await click(button('Save visit'))
    await wait(50)
    await click(button('Save visit'))
    await wait(50)
    expect(inserted.map((i) => i.table)).toEqual(['mpg_prospects', 'mpg_touches', 'mpg_touches'])
    expect(inserted[2].row.prospect_id).toBe('p-new')
  })

  const TOUCH = {
    id: 't9', business_name: 'NJR Salons', contact_id: 'c1', occurred_at: new Date(2026, 10, 3, 9, 30).toISOString(),
    contact_label: 'Jimmy / Owner', reach_label: '832-474-7707 / a@b.com', notes: 'old', next_step: null,
    follow_up_on: null, temperature: null,
  }

  it('edit mode keeps the original time, splits phone and email, and writes no Zoho', async () => {
    await render(React.createElement(LogVisitDialog, { onClose: () => {}, touch: TOUCH }))
    expect(byLabel('Phone').value).toBe('832-474-7707')
    expect(byLabel('Email').value).toBe('a@b.com')
    await type(byLabel('Notes'), 'new')
    await click(button('Save visit'))
    await wait(50)
    expect(updated).toHaveLength(1)
    expect('occurred_at' in updated[0]).toBe(false)
    expect(updated[0].notes).toBe('new')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('Change clears the contact fields', async () => {
    await render(React.createElement(LogVisitDialog, { onClose: () => {} }))
    await type(byLabel('Business'), 'Feges BBQ')
    await wait()
    await click(button('Add new business'))
    await type(byLabel('Contact name'), 'Patrick')
    await type(byLabel('Phone'), '555')
    await click(button('Change'))
    expect(byLabel('Contact name').value).toBe('')
    expect(byLabel('Phone').value).toBe('')
  })
})
