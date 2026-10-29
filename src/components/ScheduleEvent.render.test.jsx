// @vitest-environment jsdom
// Schedule a call or meeting from a contact: the form saves a contact_events
// row, drops a note in the CRM only when "Add note" is checked, and the
// contact's upcoming list offers Done / Cancel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const inserted = []
const updates = []
const DATA = { upcoming: [], writeback: { bay: true, mpg: true } }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'order']) q[m] = () => q
  q.insert = (row) => {
    inserted.push(row)
    return { select: () => ({ single: async () => ({ data: { id: 'e1', ...row }, error: null }) }) }
  }
  q.update = (patch) => ({
    eq: async (col, id) => {
      updates.push({ table, patch, id })
      return { error: null }
    },
  })
  q.maybeSingle = async () => (table === 'settings' ? { data: { value: DATA.writeback }, error: null } : { data: null, error: null })
  q.then = (resolve) => resolve({ data: table === 'contact_events' ? DATA.upcoming : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { ScheduleButton, UpcomingEvents } = await import('./ScheduleEvent')
const { default: Toaster } = await import('./Toaster')
const { resetWritebackFlags } = await import('../lib/writeback')

beforeEach(() => {
  document.body.innerHTML = ''
  inserted.length = 0
  updates.length = 0
  DATA.upcoming = []
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
  await act(async () => {})
  return host
}

const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
const click = (el) => act(async () => el.click())

async function openForm() {
  const host = await render(React.createElement(ScheduleButton, { businessId: 'mpg', contactId: 'c1', contactName: 'Jane Doe' }))
  await click(button(host, 'Schedule'))
  await act(async () => {})
  return document.querySelector('[role="dialog"][aria-label="Schedule call or meeting"]')
}

function setSelect(el, value) {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ScheduleButton', () => {
  it('saves a call with the defaults and adds a note in Zoho', async () => {
    const dialog = await openForm()
    expect(dialog).not.toBe(null)
    await click(button(dialog, 'Schedule call'))
    await act(async () => {})
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ business_id: 'mpg', contact_id: 'c1', kind: 'call', duration_min: 30, remind_min: 10, note: null })
    expect(new Date(inserted[0].starts_at).getTime()).toBeGreaterThan(Date.now())
    expect(invoke).toHaveBeenCalledWith('crm-action', {
      body: expect.objectContaining({ action: 'add_note', contact_id: 'c1', payload: { body: expect.stringMatching(/^Scheduled call .* · 30 min$/) } }),
    })
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    expect(document.querySelector('[role="status"]').textContent).toMatch(/Call with Jane · .* scheduled · note added in Zoho/)
  })

  it('saves a meeting with its own length and no reminder, and skips the CRM note when unchecked', async () => {
    const dialog = await openForm()
    await click(button(dialog, 'Meeting'))
    await click(button(dialog, '60 min'))
    await act(async () => setSelect(dialog.querySelector('select[aria-label="Remind me"]'), ''))
    await click(dialog.querySelector('input[type="checkbox"]'))
    await click(button(dialog, 'Schedule meeting'))
    await act(async () => {})
    expect(inserted[0]).toMatchObject({ kind: 'meeting', duration_min: 60, remind_min: null })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('hides the CRM note when write-back is off for the book', async () => {
    DATA.writeback = { bay: true, mpg: false }
    const dialog = await openForm()
    expect(dialog.querySelector('input[type="checkbox"]')).toBe(null)
    await click(button(dialog, 'Schedule call'))
    await act(async () => {})
    expect(inserted).toHaveLength(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps the event and offers Retry when the CRM note fails', async () => {
    invoke.mockResolvedValue({ data: { status: 'error', results: [{ step: 'add_note', ok: false, error: 'Zoho down' }] }, error: null })
    const dialog = await openForm()
    await click(button(dialog, 'Schedule call'))
    await act(async () => {})
    expect(inserted).toHaveLength(1)
    const toast = document.querySelector('[role="status"]')
    expect(toast.textContent).toContain('Scheduled — note not added in Zoho')
    expect(button(toast, 'Retry')).toBeTruthy()
  })
})

describe('UpcomingEvents', () => {
  it("lists the contact's scheduled events and cancels one", async () => {
    DATA.upcoming = [
      { id: 'e9', kind: 'meeting', starts_at: new Date(2026, 9, 30, 14, 30).toISOString(), duration_min: 45, note: 'site visit', status: 'scheduled' },
    ]
    const host = await render(React.createElement(UpcomingEvents, { contactId: 'c1' }))
    const item = host.querySelector('[data-upcoming]')
    expect(item.textContent).toContain('Meeting')
    expect(item.textContent).toContain('Fri 10/30 2:30 PM · 45 min')
    expect(item.textContent).toContain('site visit')
    await click(button(item, 'Cancel'))
    expect(updates).toEqual([{ table: 'contact_events', patch: { status: 'canceled' }, id: 'e9' }])
  })

  it('renders nothing with no upcoming events', async () => {
    const host = await render(React.createElement(UpcomingEvents, { contactId: 'c1' }))
    expect(host.querySelector('[aria-label="Upcoming"]')).toBe(null)
  })
})
