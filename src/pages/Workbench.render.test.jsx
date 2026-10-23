// @vitest-environment jsdom
// The Workbench against a fake Supabase: both lanes, the header counts, Done
// on an estimate (moves the FUB stage) and on an MPG Zoho task (completes it),
// Open into the person sheet, the Calls | Work switch on a phone, and the
// work_items writes: Update (status, waiting on, check back, notes), Mark
// reviewed, + Work item and the Waiting on others bar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const iso = (daysAgo, hh = 12) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hh, 0, 0, 0)
  return d.toISOString()
}
const DATA = { signals: [], pipeline: [], tasks: [], people: {}, workItems: [], contacts: [] }
const writes = []

function query(table) {
  const q = {}
  let id = null
  for (const m of ['select', 'in', 'order', 'range', 'gte', 'or', 'limit', 'gt', 'lte']) q[m] = () => q
  q.eq = (c, v) => {
    if (c === 'id') id = v
    return q
  }
  for (const op of ['insert', 'upsert', 'update']) {
    q[op] = (body, opts) => {
      writes.push({ table, op, body, opts })
      return q
    }
  }
  q.maybeSingle = async () => {
    if (table === 'settings') return { data: { value: { bay: true, mpg: true, daily_cap: 15 } }, error: null }
    if (table === 'v_people') return { data: DATA.people[id] ?? null, error: null }
    return { data: null, error: null }
  }
  q.then = (resolve) =>
    resolve({
      data:
        table === 'v_lead_signals' ? DATA.signals
          : table === 'v_active_pipeline' ? DATA.pipeline
            : table === 'v_tasks' ? DATA.tasks
              : table === 'work_items' ? DATA.workItems
                : table === 'contacts' ? DATA.contacts
                  : [],
      error: null,
    })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), rpc: vi.fn(async () => ({ data: [], error: null })), functions: { invoke: (...a) => invoke(...a) } },
}))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: 'all', matches: () => true }) }))

let mobile = false
beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  writes.length = 0
  DATA.workItems = []
  DATA.contacts = []
  window.matchMedia = (q) => ({ matches: mobile && q.includes('max-width'), addEventListener() {}, removeEventListener() {} })
  DATA.signals = [
    {
      id: 'c1', business_id: 'bay', name: 'Ana Inbound', company: null, phone: '7135550142', crm_profile_url: '#',
      stage: 'Attempted', stage_since: null, is_hot: false, is_active: true, is_partner: false, score: null,
      crm_created_at: iso(400), crm_last_activity_at: null, last_outbound_at: iso(3), last_outbound_call_at: iso(3),
      last_inbound_at: iso(0, 9), open_task_count: 0, oldest_open_due_at: null, snooze_count_60d: 0,
    },
  ]
  DATA.pipeline = [
    { id: 'e1', name: 'Gil Estimate', stage: 'Contacted/Working', stage_since: iso(8), open_task_count: 0, oldest_open_due_at: null, docs_outstanding_count: 0 },
    { id: 'a1', name: 'Ivy Application', stage: 'Application Received', stage_since: iso(2), open_task_count: 0, oldest_open_due_at: null, docs_outstanding_count: 2 },
  ]
  DATA.tasks = [{ id: 't1', title: '3 Statements FU', due_at: iso(5), contact_id: 'm1', contact_name: 'David', company: 'Lending Flow', business_id: 'mpg' }]
  DATA.people = {
    e1: { id: 'e1', business_id: 'bay', name: 'Gil Estimate', company: null, phone: '7135550100', email: null, stage: 'Contacted/Working', on_board: true, crm_profile_url: '#' },
  }
})

const { default: Workbench } = await import('./Workbench')
const { default: Toaster } = await import('../components/Toaster')
const { refreshPriorityQueue } = await import('../lib/usePriorityQueue')
const { resetWritebackFlags } = await import('../lib/writeback')

async function render() {
  resetWritebackFlags()
  await refreshPriorityQueue()
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(MemoryRouter, null, React.createElement(Workbench), React.createElement(Toaster)),
    )
  })
  await act(async () => {})
  await act(async () => {})
  return host
}

const type = async (label, value) =>
  act(async () => {
    const el = document.querySelector(`[aria-label="${label}"]`)
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const dialog = () => document.querySelector('[role="dialog"]')
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const workItem = (title) => [...document.querySelectorAll('[data-work-item]')].find((e) => e.textContent.includes(title))

describe('Workbench', () => {
  it('shows the Calls and Work lanes with counts', async () => {
    mobile = false
    const host = await render()
    expect(host.querySelector('h1').textContent).toBe('Workbench')
    expect(host.querySelector('[aria-label="Calls"]').textContent).toContain('Ana Inbound')
    const work = host.querySelector('[aria-label="Work"]')
    expect(work.textContent).toContain('Estimates to Work')
    expect(work.textContent).toContain('Applications to Review')
    expect(work.textContent).toContain('Statement/Proposal Review')
    expect(workItem('Gil Estimate').textContent).toContain('Working 8 days')
    expect(workItem('Ivy Application').textContent).toContain('2 docs missing')
    expect(workItem('3 Statements FU').textContent).toContain('Lending Flow · David')
    expect(host.querySelector('header').textContent).toContain('0 / 3')
  })

  it('marks an estimate sent, which moves the FUB stage', async () => {
    mobile = false
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await render()
    await act(async () => button(workItem('Gil Estimate'), 'Done').click())
    await act(async () => button(document.querySelector('[role="dialog"]'), 'Estimate sent').click())
    await act(async () => {})
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', contact_id: 'e1', payload: { target: 'estimate_sent' } })
    expect(document.body.textContent).toContain('Gil Estimate moved to Estimate sent in FollowUpBoss')
    // ...and records it as done today for the Work progress bar.
    expect(writes[0]).toMatchObject({ table: 'work_items', op: 'upsert', body: { source_key: 'estimate:e1', status: 'done' } })
  })

  it('suggests Estimate sent first for a DSCR lead, and shows rough times', async () => {
    mobile = false
    DATA.contacts = [{ id: 'e1', tags: ['Active', 'DSCR'] }]
    await render()
    expect(workItem('Gil Estimate').textContent).toContain('~25m')
    expect(workItem('Ivy Application').textContent).toContain('~20m')
    await act(async () => button(workItem('Gil Estimate'), 'Done').click())
    const dialog = document.querySelector('[role="dialog"]')
    const choices = [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.endsWith('sent'))
    expect(choices).toEqual(['Estimate sent', 'Application sent'])
    expect(dialog.textContent).toContain('Suggested: DSCR lead')
  })

  it('suggests Application sent first for a buyer', async () => {
    mobile = false
    DATA.contacts = [{ id: 'e1', tags: ['Active'] }]
    await render()
    await act(async () => button(workItem('Gil Estimate'), 'Done').click())
    const dialog = document.querySelector('[role="dialog"]')
    const choices = [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.endsWith('sent'))
    expect(choices).toEqual(['Application sent', 'Estimate sent'])
    expect(dialog.textContent).toContain('Suggested: buyer who needs a pre-approval')
  })

  it('completes an MPG Zoho task', async () => {
    mobile = false
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'complete_task', ok: true }] }, error: null })
    await render()
    await act(async () => button(workItem('3 Statements FU'), 'Done').click())
    await act(async () => {})
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'complete_task', task_id: 't1' })
  })

  it('opens the lead from a work item', async () => {
    mobile = false
    await render()
    await act(async () => button(workItem('Gil Estimate'), 'Open').click())
    await act(async () => {})
    expect(document.querySelector('[role="dialog"][aria-label="Gil Estimate"]')).not.toBe(null)
    // Applications get Mark reviewed, never a CRM Done.
    expect(button(workItem('Ivy Application'), 'Done')).toBe(undefined)
    expect(button(workItem('Ivy Application'), 'Mark reviewed')).not.toBe(undefined)
  })

  it('shows one lane at a time on a phone', async () => {
    mobile = true
    const host = await render()
    expect(host.querySelector('[aria-label="Calls"]')).not.toBe(null)
    expect(host.querySelector('[aria-label="Work"]')).toBe(null)
    await act(async () => button(host, 'Work · 3').click())
    expect(host.querySelector('[aria-label="Calls"]')).toBe(null)
    expect(host.querySelector('[aria-label="Work"]')).not.toBe(null)
  })

  it('shows Work done today in the header', async () => {
    mobile = false
    DATA.workItems = [{ id: 'w9', kind: 'custom', business_id: 'bay', title: 'Old one', status: 'done', done_at: new Date().toISOString(), created_at: iso(1) }]
    const host = await render()
    expect(host.querySelector('header').textContent).toContain('1 / 4')
  })

  it('parks an estimate as waiting on the lender with a check-back day and a note', async () => {
    mobile = false
    await render()
    await act(async () => button(workItem('Gil Estimate'), 'Update').click())
    await act(async () => button(dialog(), 'Waiting on…').click())
    await act(async () => button(dialog(), 'Lender').click())
    await act(async () => button(dialog(), 'Next Monday').click())
    await type('Work notes', 'Rate sheet asked for')
    await act(async () => button(dialog(), 'Save').click())
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      table: 'work_items',
      op: 'upsert',
      opts: { onConflict: 'user_id,source_key' },
      body: { source_key: 'estimate:e1', kind: 'estimate', business_id: 'bay', contact_id: 'e1', status: 'waiting', waiting_on: 'Lender', notes: 'Rate sheet asked for' },
    })
    expect(writes[0].body.check_back_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('marks an application reviewed for 3 days', async () => {
    mobile = false
    await render()
    await act(async () => button(workItem('Ivy Application'), 'Mark reviewed').click())
    expect(writes[0]).toMatchObject({ op: 'upsert', body: { source_key: 'application:a1', kind: 'application', status: 'done' } })
    expect(document.body.textContent).toContain('Ivy Application reviewed. Back in 3 days, or sooner if docs change.')
  })

  it('adds a custom work item', async () => {
    mobile = false
    const host = await render()
    await act(async () => button(host, '+ Work item').click())
    await type('Work item title', 'ZZ Call the appraiser')
    await act(async () => button(dialog(), 'MPG').click())
    await act(async () => button(dialog(), 'Add').click())
    expect(writes[0]).toMatchObject({ table: 'work_items', op: 'insert', body: { kind: 'custom', business_id: 'mpg', title: 'ZZ Call the appraiser', contact_id: null } })
  })

  it('keeps waiting items in a collapsed bar until opened', async () => {
    mobile = false
    const later = new Date()
    later.setDate(later.getDate() + 3)
    DATA.workItems = [{ id: 'w1', source_key: 'estimate:e1', kind: 'estimate', business_id: 'bay', status: 'waiting', waiting_on: 'Borrower', check_back_on: later.toISOString().slice(0, 10) }]
    const host = await render()
    expect(workItem('Gil Estimate')).toBe(undefined)
    const bar = host.querySelector('button[aria-expanded]')
    expect(bar.textContent).toContain('Waiting on others · 1')
    await act(async () => bar.click())
    expect(workItem('Gil Estimate').textContent).toContain('Waiting on Borrower')
  })
})
