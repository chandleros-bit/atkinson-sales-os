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
const DATA = { notes: [], firstNote: null }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'gte', 'or', 'limit']) q[m] = () => q
  q.maybeSingle = async () => {
    if (table === 'v_people') {
      return { data: { id: 'c1', business_id: 'bay', name: 'Cj Blackman', company: null, phone: '8325550100', email: null, stage: 'New Lead', on_board: false, crm_profile_url: '#' }, error: null }
    }
    if (table === 'contacts') return { data: { first_note: DATA.firstNote }, error: null }
    if (table === 'settings') return { data: { value: { bay: true, mpg: true } }, error: null }
    return { data: null, error: null }
  }
  q.then = (resolve) => resolve({ data: table === 'activities' ? DATA.notes : [], error: null })
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
