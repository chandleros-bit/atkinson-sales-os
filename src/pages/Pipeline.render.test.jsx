// @vitest-environment jsdom
// Drag between stages on the Bayway board: a drop writes the column's FUB tag
// through crm-action set_stage, the shared Application/Estimate Sent column
// asks which tag, a failed move snaps back, and MPG stays read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

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
      React.createElement(MemoryRouter, null, React.createElement(Pipeline, { biz }), React.createElement(Toaster)),
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
  // The board tests below open on the Board view; the views block resets this.
  localStorage.setItem('pipeline-view', 'board')
  DATA.rows = [card('a', 'Ana Lead', 'New Lead'), card('b', 'Ben Working', 'Contacted/Working')]
})

describe('Pipeline views', () => {
  const rowIds = () => [...document.querySelectorAll('[data-row-id]')].map((e) => e.getAttribute('data-row-id'))
  const viewButton = (label) => [...document.querySelectorAll('[aria-label="View"] button')].find((b) => b.textContent.trim() === label)

  beforeEach(() => {
    localStorage.removeItem('pipeline-view')
    DATA.rows = [
      { ...card('a', 'Ana Lead', 'New Lead'), email: 'ana@x.co' },
      { ...card('b', 'Ben Working', 'Contacted/Working'), open_task_count: 1, oldest_open_due_at: ago(3) },
      { ...card('c', 'Cy Applied', 'Application Received'), docs_tracked: true, docs_outstanding_count: 2, docs_outstanding: ['W2', 'Paystubs'], docs_oldest_requested_at: ago(9) },
    ]
  })

  it('opens on List: KPI cards, then one row per lead, most urgent first', async () => {
    await mount()
    expect(document.querySelector('[data-view="list"]')).not.toBeNull()
    expect(document.querySelector('[data-kpi="active"]').textContent).toContain('3')
    expect(document.querySelector('[data-kpi="received"]').textContent).toContain('1 with docs aging')
    expect(rowIds()[0]).toBe('b')
    const cy = document.querySelector('[data-row-id="c"]')
    expect(cy.textContent).toContain('2 missing · 9d')
    expect(cy.querySelector('[data-stage-step]').getAttribute('data-stage-step')).toBe('5')
  })

  it('search narrows every view; the cards still count the whole board', async () => {
    await mount()
    const input = document.querySelector('[aria-label="Search this pipeline"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ana@')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rowIds()).toEqual(['a'])
    expect(document.querySelector('[data-kpi="active"]').textContent).toContain('3')
  })

  it('shows each lead source as a pill in List, By stage and Board', async () => {
    DATA.rows = [
      { ...card('a', 'Ana Lead', 'New Lead'), lead_source: 'LendingFlow' },
      { ...card('b', 'Ben Working', 'Contacted/Working'), lead_source: '<unspecified>' },
    ]
    await mount()
    const pills = () => [...document.querySelectorAll('[data-lead-source]')].map((e) => e.textContent)
    expect(document.querySelector('[data-row-id="a"] [data-lead-source]').textContent).toBe('LendingFlow')
    expect(document.querySelector('[data-row-id="b"] [data-lead-source]')).toBeNull()
    expect(pills()).toEqual(['LendingFlow'])
    await act(async () => viewButton('By stage').click())
    expect(document.querySelector('[data-row-id="a"] [data-lead-source]').textContent).toBe('LendingFlow')
    await act(async () => viewButton('Board').click())
    expect(cardEl('a').querySelector('[data-lead-source]').textContent).toBe('LendingFlow')
    expect(cardEl('b').querySelector('[data-lead-source]')).toBeNull()
  })

  it('By stage groups the rows under their stage; the choice is remembered', async () => {
    await mount()
    await act(async () => viewButton('By stage').click())
    expect([...document.querySelectorAll('[data-group]')].map((e) => e.getAttribute('data-group'))).toEqual([
      'New Lead', 'Contacted/Working', 'Application Received',
    ])
    expect(localStorage.getItem('pipeline-view')).toBe('grouped')
    await act(async () => viewButton('Board').click())
    expect(column('New Lead')).not.toBeNull()
  })
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

  it('offers a follow-up after a move that leaves nothing scheduled', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    DATA.rows = [{ ...card('a', 'Ana Lead', 'New Lead'), open_task_count: 0 }]
    await mount()
    await dragTo('a', 'Attempted')
    await act(async () => {})
    expect(document.querySelector('[role="dialog"][aria-label="Next step for Ana?"]')).not.toBe(null)
  })

  it('keeps the follow-up offer open when Move stage redraws the card in its new column', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    DATA.rows = [{ ...card('a', 'Ana Lead', 'New Lead'), open_task_count: 0 }]
    await mount()
    await act(async () => cardEl('a').querySelector('[aria-label="Move stage"]').click())
    const attempted = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')].find((b) => b.textContent.trim() === 'Attempted')
    // The reload after the move finds the lead in its new column.
    DATA.rows = [{ ...card('a', 'Ana Lead', 'Attempted'), open_task_count: 0 }]
    await act(async () => attempted.click())
    await act(async () => {})
    expect(cardsIn('Attempted')).toEqual(['a'])
    expect(document.querySelector('[role="dialog"][aria-label="Next step for Ana?"]')).not.toBe(null)
  })

  it('keeps the MPG board read-only', async () => {
    DATA.rows = [{ id: 'm', name: 'Ana', company: 'Deli', stage: 'Open', last_touch_at: null, crm_profile_url: '#' }]
    await mount('mpg')
    expect(cardEl('m').getAttribute('draggable')).toBe('false')
    expect(document.body.textContent).not.toContain('Drop a lead here')
  })
})

describe('Pipeline drop zones', () => {
  const zone = () => document.querySelector('[data-zone="credit_repair"]')

  it('shows the Nurture zone only while a card is dragged', async () => {
    await mount()
    expect(document.querySelector('[data-drop-zones]')).toBe(null)
    await fire(cardEl('a'), 'dragstart')
    expect(zone().textContent).toContain('Nurture / Credit Repair')
    await fire(cardEl('a'), 'dragend')
    expect(document.querySelector('[data-drop-zones]')).toBe(null)
  })

  it('parks the dragged lead in Nurture without asking for a next step', async () => {
    let resolve
    invoke.mockImplementation(() => new Promise((r) => { resolve = r }))
    DATA.rows = [{ ...card('a', 'Ana Lead', 'New Lead'), open_task_count: 0 }]
    await mount()
    await fire(cardEl('a'), 'dragstart')
    await fire(zone(), 'dragover')
    await fire(zone(), 'drop')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', contact_id: 'a', payload: { target: 'credit_repair' } })
    expect(cardsIn('Nurture / Credit Repair')).toEqual(['a'])
    expect(document.querySelector('[data-drop-zones]')).toBe(null)
    DATA.rows = [{ ...card('a', 'Ana Lead', 'Nurture / Credit Repair'), open_task_count: 0 }]
    await act(async () => resolve({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null }))
    await act(async () => {})
    expect(document.body.textContent).toContain('Ana Lead moved to Nurture / Credit Repair in FollowUpBoss')
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('marks a lead Lost with a reason, warns it is one-way, and drops it from the board', async () => {
    invoke.mockResolvedValueOnce({
      data: { status: 'ok', results: [{ step: 'set_stage', ok: true, previous_target: 'attempted' }, { step: 'add_note', ok: true }] },
      error: null,
    })
    DATA.rows = [{ ...card('a', 'Ana Lead', 'Attempted'), open_task_count: 0 }]
    await mount()
    await fire(cardEl('a'), 'dragstart')
    const lost = document.querySelector('[data-zone="lost"]')
    expect(document.querySelector('[data-zone="credit_repair"]')).not.toBe(null)
    await fire(lost, 'dragover')
    await fire(lost, 'drop')
    expect(invoke).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Only the FUB account owner can move it back')
    const why = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Went elsewhere')
    DATA.rows = []
    await act(async () => why.click())
    await act(async () => {})
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', contact_id: 'a', payload: { target: 'lost', reason: 'Went elsewhere' } })
    expect(cardEl('a')).toBe(null)
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    expect(document.body.textContent).toContain('Ana Lead marked Lost in FollowUpBoss')
    // FUB's Lost Leads plan moves the person stage, which the dashboard can't
    // reverse, so there is no Undo.
    expect([...document.querySelectorAll('[role="status"] button')].some((b) => b.textContent === 'Undo')).toBe(false)
  })

  it('offers no zone for a lead already in Nurture', async () => {
    DATA.rows = [card('n', 'Nell Parked', 'Nurture / Credit Repair')]
    await mount()
    await fire(cardEl('n'), 'dragstart')
    expect(document.querySelector('[data-zone="credit_repair"]')).toBe(null)
    expect(document.querySelector('[data-zone="lost"]')).not.toBe(null)
  })
})

// Noon local N days ago, so whole-day maths can't flip at midnight or DST.
const ago = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('Pipeline paging', () => {
  const many = (n, stage = 'Attempted') => Array.from({ length: n }, (_, i) => card(`p${i + 1}`, `Lead ${i + 1}`, stage))
  const rowIds = () => [...document.querySelectorAll('[data-row-id]')].map((e) => e.getAttribute('data-row-id'))
  const btn = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

  it('List shows 25 leads a page with Prev / Next', async () => {
    localStorage.setItem('pipeline-view', 'list')
    DATA.rows = many(30)
    await mount()
    expect(rowIds()).toHaveLength(25)
    const pager = document.querySelector('[data-pager]')
    expect(pager.textContent).toContain('1–25 of 30')
    expect(btn(pager, 'Prev').disabled).toBe(true)
    await act(async () => btn(pager, 'Next').click())
    expect(rowIds()).toHaveLength(5)
    expect(document.querySelector('[data-pager]').textContent).toContain('26–30 of 30')
  })

  it('Board columns share the page width and show 25 cards, then Show more', async () => {
    DATA.rows = many(60)
    await mount()
    const board = document.querySelector('[data-view="board"]')
    expect(board.style.gridTemplateColumns).toContain('repeat(')
    expect(cardsIn('Attempted')).toHaveLength(25)
    await act(async () => btn(column('Attempted'), 'Show 25 more · 35 left').click())
    expect(cardsIn('Attempted')).toHaveLength(50)
    await act(async () => btn(column('Attempted'), 'Show 10 more · 10 left').click())
    expect(cardsIn('Attempted')).toHaveLength(60)
    expect(btn(column('Attempted'), 'Show 10 more · 10 left')).toBeUndefined()
  })

  it('By stage pages each stage 25 at a time', async () => {
    localStorage.setItem('pipeline-view', 'grouped')
    DATA.rows = [...many(27), card('n', 'New One', 'New Lead')]
    await mount()
    const group = document.querySelector('[data-group="Attempted"]')
    expect(group.querySelectorAll('[data-row-id]')).toHaveLength(25)
    expect(document.querySelector('[data-group="New Lead"] [data-pager]')).toBeNull()
    await act(async () => btn(group.querySelector('[data-pager]'), 'Next').click())
    expect(group.querySelectorAll('[data-row-id]')).toHaveLength(2)
  })
})

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
    expect(column('Attempted').querySelector('[data-col-count]').textContent).toBe('2')
    expect(column('Attempted').textContent).toContain('1 overdue · 1 stuck')
    expect(cardsIn('Attempted')).toEqual(['a', 'b'])
  })

  it('tints the pills and steps each Bayway column toward Application Received', async () => {
    DATA.rows = [
      { ...card('a', 'Ana Late', 'Attempted'), open_task_count: 1, oldest_open_due_at: ago(3), stage_since: ago(1) },
      { ...card('n', 'Ned Nurture', 'Nurture / Credit Repair') },
    ]
    await mount()
    expect(cardEl('a').querySelector('[data-health="overdue"]').style.color).toBe('var(--neg-ink)')
    expect(column('Attempted').querySelector('[data-stage-step]').getAttribute('data-stage-step')).toBe('2')
    expect(column('Application Received').querySelector('[data-stage-step]').getAttribute('data-stage-step')).toBe('5')
    expect(column('Nurture / Credit Repair').querySelector('[data-stage-step]')).toBeNull()
    // No sync rows in the mock: the header dot says so and links to Sync Status.
    const dot = document.querySelector('[data-sync-state]')
    expect(dot.getAttribute('data-sync-state')).toBe('unknown')
    expect(dot.getAttribute('href')).toBe('/sync')
  })

  it('leaves the MPG columns without a step bar', async () => {
    DATA.rows = [{ ...card('m', 'Mo Merchant', 'Contacted'), business_id: 'mpg' }]
    await mount('mpg')
    expect(column('Contacted').querySelector('[data-stage-step]')).toBeNull()
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

describe('Pipeline on a phone', () => {
  it('shows one stage at a time, picked from the stage chips', async () => {
    window.matchMedia = (q) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} })
    try {
      await mount()
      const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Stage"] [role="tab"]')]
      expect(tabs.map((t) => t.textContent)).toEqual([
        'New Lead1', 'Attempted0', 'Contacted/Working1', 'Application/Estimate Sent0', 'Application Received0', 'Nurture / Credit Repair0',
      ])
      expect([...document.querySelectorAll('[data-stage]')].map((e) => e.getAttribute('data-stage'))).toEqual(['New Lead'])
      await act(async () => tabs[2].click())
      expect([...document.querySelectorAll('[data-stage]')].map((e) => e.getAttribute('data-stage'))).toEqual(['Contacted/Working'])
      expect(cardsIn('Contacted/Working')).toEqual(['b'])
    } finally {
      delete window.matchMedia
    }
  })
})
