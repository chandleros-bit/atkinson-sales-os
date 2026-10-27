// @vitest-environment jsdom
// The contact card from a name anywhere: PersonLink opens it through the
// host, it shows the lead form's first note and every note (newest first,
// author and time), and it asks crm-action (read-only) for the CRM's notes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const DATA = { notes: [], firstNote: null, activity: [], board: null, signal: null, priority: null, tasks: [], onBoard: false }

function query(table) {
  const q = {}
  let typed = false
  for (const m of ['select', 'eq', 'order', 'range', 'gte', 'or', 'limit']) q[m] = () => q
  q.in = (col) => {
    if (col === 'type') typed = true
    return q
  }
  q.maybeSingle = async () => {
    if (table === 'v_people') {
      return { data: { id: 'c1', business_id: 'bay', name: 'Cj Blackman', company: null, phone: '8325550100', email: null, stage: 'Application Received', on_board: DATA.onBoard, crm_profile_url: '#' }, error: null }
    }
    if (table === 'contacts') return { data: { first_note: DATA.firstNote, owner: 'Chandler Atkinson', tags: ['DSCR'] }, error: null }
    if (table === 'settings') return { data: { value: { bay: true, mpg: true } }, error: null }
    if (table === 'v_active_pipeline') return { data: DATA.board, error: null }
    if (table === 'v_lead_signals') return { data: DATA.signal, error: null }
    if (table === 'v_priority_leads') return { data: DATA.priority, error: null }
    return { data: null, error: null }
  }
  q.then = (resolve) =>
    resolve({ data: table === 'activities' ? (typed ? DATA.activity : DATA.notes) : table === 'v_tasks' ? DATA.tasks : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), rpc: async () => ({ data: [], error: null }), functions: { invoke: (...a) => invoke(...a) } },
}))

const { PersonSheetHost } = await import('./PersonSheet')
const { default: PersonLink } = await import('./PersonLink')

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { status: 'ok', notes: 2 }, error: null })
  DATA.onBoard = false
  DATA.board = null
  DATA.signal = null
  DATA.priority = null
  DATA.tasks = []
  DATA.activity = []
  DATA.firstNote = 'Credit: 660-699 / loan type: DSCR Purchase / state: North Carolina / loan amount: $200K - $500K'
  DATA.notes = [
    { id: 'n1', occurred_at: '2026-10-20T15:00:00Z', notes: 'x', raw: { body: 'Asked for <b>bank statements</b>', isHtml: true, createdBy: 'Chandler Atkinson' } },
    { id: 'n2', occurred_at: '2026-10-22T15:00:00Z', notes: 'Sent terms, waiting on reply', raw: { body: 'Sent terms, waiting on reply', createdBy: 'Chandler Atkinson' } },
    { id: 'n0', occurred_at: '2026-10-01T15:00:00Z', notes: DATA.firstNote, raw: { body: DATA.firstNote, createdBy: 'LendingFlow' } },
  ]
})

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(React.Fragment, null, React.createElement(PersonLink, { id: 'c1', url: '#' }, 'Cj Blackman'), React.createElement(PersonSheetHost)),
    )
  })
  return host
}

describe('contact card', () => {
  it('opens from a name with the lead form note and every note, newest first', async () => {
    const host = await mount()
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    await act(async () => host.querySelector('[data-person-link]').click())
    await act(async () => {})
    await act(async () => {})
    const dialog = document.querySelector('[role="dialog"][aria-label="Cj Blackman"]')
    expect(dialog).not.toBe(null)
    expect(dialog.textContent).toContain('(832) 555-0100')
    expect(dialog.querySelector('[data-first-note]').textContent).toContain('Loan type DSCR Purchase')
    const notes = [...dialog.querySelectorAll('[data-note]')].map((n) => n.textContent)
    expect(notes).toHaveLength(2) // the lead form note is pinned, not repeated
    expect(notes[0]).toContain('Sent terms, waiting on reply')
    expect(notes[0]).toContain('Chandler Atkinson')
    expect(notes[1]).toContain('Asked for bank statements')
    expect(dialog.textContent).toContain('Open in FollowUpBoss')
  })

  it('reads the full note list from the CRM when it opens (read-only)', async () => {
    const host = await mount()
    await act(async () => host.querySelector('[data-person-link]').click())
    await act(async () => {})
    expect(invoke).toHaveBeenCalledWith('crm-action', { body: expect.objectContaining({ action: 'contact_notes', contact_id: 'c1' }) })
  })

  it("says so when the CRM can't be read and keeps the dashboard's notes", async () => {
    invoke.mockResolvedValue({ data: { status: 'error', error: 'NOT_SUPPORTED' }, error: null })
    const host = await mount()
    await act(async () => host.querySelector('[data-person-link]').click())
    await act(async () => {})
    await act(async () => {})
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain("Couldn't read every note from FollowUpBoss (NOT_SUPPORTED)")
    expect(dialog.querySelectorAll('[data-note]')).toHaveLength(2)
  })
})

describe('contact card tabs', () => {
  async function open() {
    const host = await mount()
    await act(async () => host.querySelector('[data-person-link]').click())
    await act(async () => {})
    await act(async () => {})
    return document.querySelector('[role="dialog"]')
  }
  const tab = (dialog, label) => [...dialog.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith(label))
  const pick = (dialog, label) => act(async () => tab(dialog, label).click())

  beforeEach(() => {
    DATA.onBoard = true
    DATA.board = {
      id: 'c1', stage: 'Application Received', stage_since: null, open_task_count: 1, oldest_open_due_at: '2026-01-02T15:00:00Z',
      docs_tracked: true, docs_outstanding: ['W2', 'Bank statements'], docs_oldest_requested_at: '2026-01-01T15:00:00Z', doc_notes: null,
    }
    DATA.signal = { lead_source: 'LendingFlow', crm_created_at: '2026-10-01T15:00:00Z', last_outbound_call_at: null }
    DATA.priority = { score: 88.2, tier: 'hot', ai_note: null }
    DATA.tasks = [{ id: 't1', title: 'Call about W2', due_at: '2026-01-02T15:00:00Z' }]
    DATA.activity = [{ id: 'a1', type: 'call', occurred_at: '2026-10-22T16:00:00Z', notes: 'Left VM', direction: 'outbound' }]
  })

  it('opens on Notes, with the stage step, health pills and priority score above the tabs', async () => {
    const dialog = await open()
    expect([...dialog.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Notes2', 'Activity', 'Loan', 'Details'])
    expect(tab(dialog, 'Notes').getAttribute('aria-selected')).toBe('true')
    expect(dialog.querySelector('[data-stage-step]').getAttribute('data-stage-step')).toBe('5')
    expect(dialog.querySelector('[data-health="overdue"]')).not.toBe(null)
    expect(dialog.querySelector('[data-priority]').textContent).toBe('Priority score 88 · Hot')
  })

  it('Activity lists calls, texts, emails and appointments', async () => {
    const dialog = await open()
    await pick(dialog, 'Activity')
    const rows = dialog.querySelectorAll('[data-card-activity]')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Left VM')
    expect(rows[0].textContent).toContain('outbound')
  })

  it('Loan shows the lead form scenario and missing docs', async () => {
    const dialog = await open()
    await pick(dialog, 'Loan')
    expect([...dialog.querySelectorAll('[data-loan-fact]')].map((d) => d.textContent)).toEqual(['660-699', 'DSCR Purchase', 'North Carolina', '$200K - $500K'])
    expect([...dialog.querySelectorAll('[data-missing-doc]')].map((d) => d.textContent)).toEqual(['W2', 'Bank statements'])
  })

  it('Details shows source, owner, tags and open tasks', async () => {
    const dialog = await open()
    await pick(dialog, 'Details')
    expect(dialog.querySelector('[data-detail="Lead source"]').textContent).toBe('LendingFlow')
    expect(dialog.querySelector('[data-detail="Owner"]').textContent).toBe('Chandler Atkinson')
    expect(dialog.querySelector('[data-detail="Tags"]').textContent).toBe('DSCR')
    expect(dialog.querySelector('[aria-label="Details"]').textContent).toContain('Call about W2')
  })
})
