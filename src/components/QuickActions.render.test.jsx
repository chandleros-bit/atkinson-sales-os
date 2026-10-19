// @vitest-environment jsdom
// QuickActions against a mocked crm-action: the double-submit guard, partial
// results with a per-step retry, form contents surviving an error, and the
// no-phone / flag-off rules. Same createRoot + act style as Overview.render.test.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const openTasks = { rows: [] }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'lte', 'order', 'limit']) q[m] = () => q
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { bay: true, mpg: false } } : null, error: null })
  q.then = (resolve) => resolve({ data: table === 'v_tasks' ? openTasks.rows : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: QuickActions } = await import('./QuickActions')
const { resetWritebackFlags } = await import('../lib/writeback')

async function mount(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(QuickActions, props))
  })
  return host
}

const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`)
const byText = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const click = async (el) => act(async () => el.click())
const type = async (el, value) =>
  act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

const bay = { businessId: 'bay', contactId: 'c1', contactName: 'Jo Ramirez', hasPhone: true }

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  openTasks.rows = []
  resetWritebackFlags()
})

describe('QuickActions', () => {
  it('renders nothing for a book whose write-back flag is off', async () => {
    const host = await mount({ ...bay, businessId: 'mpg' })
    expect(host.innerHTML).toBe('')
  })

  it('disables Log call with a tooltip when the contact has no phone', async () => {
    await mount({ ...bay, hasPhone: false })
    const btn = byLabel('Log call')
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe('No phone on file in FUB')
    expect(byLabel('Add note').disabled).toBe(false)
  })

  it('sends one request when submit is clicked twice', async () => {
    let resolve
    invoke.mockImplementation(() => new Promise((r) => { resolve = r }))
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Busy'))
    const submit = byText('Log call')
    await act(async () => {
      submit.click()
      submit.click()
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    const [name, { body }] = invoke.mock.calls[0]
    expect(name).toBe('crm-action')
    expect(body).toMatchObject({ action: 'log_call', contact_id: 'c1', payload: { outcome: 'Busy', duration_min: 1 } })
    expect(body.payload.follow_up).toMatchObject({ title: 'Follow up: Jo' })
    await act(async () => resolve({ data: { status: 'ok', results: [{ step: 'log_call', ok: true }] }, error: null }))
    expect(document.body.textContent).toContain('logged in FollowUpBoss')
  })

  it('names the failed step on a partial and retries only that step', async () => {
    const onDone = vi.fn()
    invoke.mockResolvedValueOnce({
      data: { status: 'partial', results: [{ step: 'log_call', ok: true }, { step: 'create_task', ok: false, error: 'FUB 422' }] },
      error: null,
    })
    await mount({ ...bay, onDone })
    await click(byLabel('Log call'))
    await click(byText('No answer'))
    await click(byText('Log call'))
    expect(document.querySelector('[role="alert"]').textContent).toContain('Call logged in FollowUpBoss. Follow-up task failed: FUB 422.')
    expect(onDone).toHaveBeenCalled()

    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'create_task', ok: true }] }, error: null })
    const firstId = invoke.mock.calls[0][1].body.client_action_id
    await click(byText('Retry follow-up'))
    const retryBody = invoke.mock.calls[1][1].body
    expect(retryBody.action).toBe('create_task')
    expect(retryBody.contact_id).toBe('c1')
    expect(retryBody.client_action_id).not.toBe(firstId)
  })

  it('keeps the form contents after an error', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Forbidden' }) } } })
    await mount(bay)
    await click(byLabel('Add note'))
    await type(byLabel('Note'), 'Asked for W-2s')
    await click(byText('Add note'))
    expect(document.querySelector('[role="alert"]').textContent).toContain('Forbidden')
    expect(byLabel('Note').value).toBe('Asked for W-2s')
  })

  it('offers to complete the contact\'s open task when one is due', async () => {
    openTasks.rows = [{ id: 't-open', title: 'Call Jo back', due_at: '2026-10-01T00:00:00Z' }]
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [] }, error: null })
    await mount(bay)
    await click(byLabel('Log call'))
    expect(document.body.textContent).toContain('Complete open task: Call Jo back')
    await click(byText('Interested'))
    await click(byText('Log call'))
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ complete_task_id: 't-open', duration_min: 5 })
    expect(invoke.mock.calls[0][1].body.payload.follow_up).toBeUndefined()
  })

  it('completes a task row and reports pending then done', async () => {
    const onPending = vi.fn()
    const onDone = vi.fn()
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'complete_task', ok: true }] }, error: null })
    await mount({ ...bay, task: { id: 't9', title: 'Send docs' }, onPending, onDone })
    await click(byLabel('Complete task'))
    expect(onPending).toHaveBeenCalledWith('complete')
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'complete_task', task_id: 't9' })
    expect(onDone).toHaveBeenCalled()
  })

  it('reverts a task row when completing fails', async () => {
    const onFailed = vi.fn()
    invoke.mockResolvedValueOnce({ data: { status: 'error', results: [{ step: 'complete_task', ok: false, error: 'FUB 500' }] }, error: null })
    await mount({ ...bay, task: { id: 't9' }, onFailed })
    await click(byLabel('Complete task'))
    expect(onFailed).toHaveBeenCalledWith('complete')
    expect(document.body.textContent).toContain('Completing the task failed: FUB 500.')
  })
})
