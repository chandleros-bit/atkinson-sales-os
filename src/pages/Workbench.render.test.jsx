// @vitest-environment jsdom
// The Workbench against a fake Supabase: both lanes, the header counts, Done
// on an estimate (moves the FUB stage) and on an MPG Zoho task (completes it),
// Open into the person sheet, and the Calls | Work switch on a phone.
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
const DATA = { signals: [], pipeline: [], tasks: [], people: {} }

function query(table) {
  const q = {}
  let id = null
  for (const m of ['select', 'in', 'order', 'range', 'gte', 'or', 'limit', 'gt', 'lte']) q[m] = () => q
  q.eq = (c, v) => {
    if (c === 'id') id = v
    return q
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
    expect(host.textContent).toContain('3 open')
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
    // Applications get Open only until "Mark reviewed" (slice 3).
    expect(button(workItem('Ivy Application'), 'Done')).toBe(undefined)
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
})
