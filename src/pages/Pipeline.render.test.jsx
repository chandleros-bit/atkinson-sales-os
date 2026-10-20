// @vitest-environment jsdom
// Drag between stages on the Bayway board: a drop writes the column's FUB tag
// through crm-action set_stage, the shared Application/Estimate Sent column
// asks which tag, a failed move snaps back, and MPG stays read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const DATA = { rows: [] }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'range', 'lte', 'limit', 'gte', 'or']) q[m] = () => q
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { bay: true, mpg: false } } : null, error: null })
  q.then = (resolve) => resolve({ data: table.startsWith('v_') && table !== 'v_tasks' ? DATA.rows : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: Pipeline } = await import('./Pipeline')
const { default: Toaster } = await import('../components/Toaster')
const { resetWritebackFlags } = await import('../lib/writeback')

const card = (id, name, stage) => ({ id, business_id: 'bay', name, phone: '1', email: null, last_touch_at: null, stage, crm_profile_url: '#' })

async function mount(biz = 'bay') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(React.Fragment, null, React.createElement(Pipeline, { biz }), React.createElement(Toaster)),
    )
  })
  await act(async () => {})
  return host
}

const fire = async (el, type) =>
  act(async () => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
  })
const column = (stage) => document.querySelector(`[data-stage="${stage}"]`)
const cardEl = (id) => document.querySelector(`[data-card-id="${id}"]`)
const cardsIn = (stage) => [...column(stage).querySelectorAll('[data-card-id]')].map((e) => e.getAttribute('data-card-id'))

async function dragTo(id, stage) {
  await fire(cardEl(id), 'dragstart')
  await fire(column(stage), 'dragover')
  await fire(column(stage), 'drop')
}

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  resetWritebackFlags()
  DATA.rows = [card('a', 'Ana Lead', 'New Lead'), card('b', 'Ben Working', 'Contacted/Working')]
})

describe('Pipeline drag between stages', () => {
  it('shows every Bayway column, empty ones as drop zones', async () => {
    await mount()
    expect([...document.querySelectorAll('[data-stage]')].map((e) => e.getAttribute('data-stage'))).toEqual([
      'New Lead', 'Attempted', 'Contacted/Working', 'Application/Estimate Sent', 'Application Received', 'Nurture / Credit Repair',
    ])
    expect(column('Attempted').textContent).toContain('Drop a lead here')
    expect(cardEl('a').getAttribute('draggable')).toBe('true')
  })

  it('moves a card and writes the column tag to FUB', async () => {
    let resolve
    invoke.mockImplementation(() => new Promise((r) => { resolve = r }))
    await mount()
    await dragTo('a', 'Attempted')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', contact_id: 'a', payload: { target: 'attempted' } })
    // Shown in the new column while the write is in flight.
    expect(cardsIn('Attempted')).toEqual(['a'])
    expect(cardEl('a').textContent).toContain('Moving…')
    DATA.rows = [card('a', 'Ana Lead', 'Attempted'), card('b', 'Ben Working', 'Contacted/Working')]
    await act(async () => resolve({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null }))
    await act(async () => {})
    expect(cardsIn('Attempted')).toEqual(['a'])
    expect(document.body.textContent).toContain('Ana Lead moved to Attempted in FollowUpBoss')
  })

  it('asks Estimate Sent or Application Sent for the shared column', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount()
    await dragTo('a', 'Application/Estimate Sent')
    expect(invoke).not.toHaveBeenCalled()
    const pick = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Application Sent')
    await act(async () => pick.click())
    expect(invoke.mock.calls[0][1].body.payload).toEqual({ target: 'application_sent' })
  })

  it('snaps the card back and explains when FUB refuses', async () => {
    invoke.mockResolvedValue({ data: { status: 'refused', error: 'This lead is Pre-Qualified in FUB' }, error: null })
    await mount()
    await dragTo('b', 'New Lead')
    await act(async () => {})
    expect(cardsIn('Contacted/Working')).toEqual(['b'])
    expect(document.body.textContent).toContain('This lead is Pre-Qualified in FUB')
  })

  it('ignores a drop on the card\'s own column', async () => {
    await mount()
    await dragTo('a', 'New Lead')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps the MPG board read-only', async () => {
    DATA.rows = [{ id: 'm', name: 'Ana', company: 'Deli', stage: 'Open', last_touch_at: null, crm_profile_url: '#' }]
    await mount('mpg')
    expect(cardEl('m').getAttribute('draggable')).toBe('false')
    expect(document.body.textContent).not.toContain('Drop a lead here')
  })
})

// Noon local N days ago, so whole-day maths can't flip at midnight or DST.
const ago = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('Pipeline card health', () => {
  it('shows the next step, stuck days and a column summary, worst first', async () => {
    DATA.rows = [
      { ...card('b', 'Ben Quiet', 'Attempted'), open_task_count: 0, oldest_open_due_at: null, stage_since: ago(9) },
      { ...card('a', 'Ana Late', 'Attempted'), open_task_count: 1, oldest_open_due_at: ago(3), stage_since: ago(1) },
    ]
    await mount()
    expect(cardEl('a').querySelector('[data-health="overdue"]').textContent).toContain('Follow-up 3 days overdue')
    expect(cardEl('b').querySelector('[data-health="none"]').textContent).toContain('No next step')
    expect(cardEl('b').querySelector('[data-health="stuck"]').textContent).toBe('9d in Attempted')
    expect(cardEl('a').querySelector('[data-health="stuck"]')).toBeNull()
    expect(column('Attempted').querySelector('[data-col-count]').textContent).toBe('2 · 1 overdue · 1 stuck')
    expect(cardsIn('Attempted')).toEqual(['a', 'b'])
  })
})

describe('Pipeline speed-to-lead', () => {
  it('times a new, uncalled lead and marks it late after 5 minutes', async () => {
    DATA.rows = [
      { ...card('n', 'Nia New', 'New Lead'), crm_created_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_outbound_call_at: null },
      { ...card('c', 'Cal Called', 'New Lead'), crm_created_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_outbound_call_at: new Date().toISOString() },
    ]
    await mount()
    const timer = cardEl('n').querySelector('[data-health="speed"]')
    expect(timer.textContent).toContain('10m · not called')
    expect(timer.getAttribute('data-late')).toBe('true')
    expect(cardEl('c').querySelector('[data-health="speed"]')).toBeNull()
    expect(cardEl('c').querySelector('[data-health="none"]')).not.toBeNull()
  })
})
