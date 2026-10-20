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
// Log call looks up two v_tasks slices: due by today (lte) and future (gt).
const futureTasks = { rows: [] }

function query(table) {
  const q = {}
  let future = false
  for (const m of ['select', 'eq', 'lte', 'order', 'limit']) q[m] = () => q
  q.gt = () => {
    future = true
    return q
  }
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { bay: true, mpg: false } } : null, error: null })
  q.then = (resolve) => resolve({ data: table === 'v_tasks' ? (future ? futureTasks.rows : openTasks.rows) : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: QuickActions } = await import('./QuickActions')
const { resetWritebackFlags } = await import('../lib/writeback')
const { default: Toaster } = await import('./Toaster')

async function mount(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(React.Fragment, null, React.createElement(QuickActions, props), React.createElement(Toaster)))
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
  futureTasks.rows = []
  resetWritebackFlags()
})

describe('QuickActions', () => {
  it('renders nothing for a book whose write-back flag is off', async () => {
    await mount({ ...bay, businessId: 'mpg' })
    expect(document.querySelectorAll('button')).toHaveLength(0)
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
    await click(byText('No Answer'))
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
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ complete_task_id: 't-open', duration_min: 5, next_step: 'follow_up' })
    expect(invoke.mock.calls[0][1].body.payload.follow_up).toMatchObject({ title: 'Follow up: Jo' })
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

describe('QuickActions: Log call next step', () => {
  const save = () => byText('Log call')
  const ok = () => invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'log_call', ok: true }] }, error: null })

  it('makes a dead-end call say why there is no next step before it saves', async () => {
    ok()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Not Interested'))
    expect(save().disabled).toBe(true)
    await click(byText('No next step'))
    expect(save().disabled).toBe(true)
    await click(byText('Not interested'))
    expect(save().disabled).toBe(false)
    await click(save())
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload).toMatchObject({ next_step: 'none', no_next_step_reason: 'Not interested' })
    expect(payload.follow_up).toBeUndefined()
    expect(payload.set_stage).toBeUndefined()
  })

  it('parks the lead in Nurture when that is the reason', async () => {
    ok()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('No next step'))
    await click(byText('Moving to Nurture'))
    await click(save())
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ no_next_step_reason: 'Moving to Nurture', set_stage: 'credit_repair' })
  })

  it('uses the task already on the books instead of adding another', async () => {
    futureTasks.rows = [{ id: 't-fut', title: 'Follow up: Jo', due_at: '2099-01-02T00:00:00Z' }]
    ok()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Left Message'))
    expect(byText('Already scheduled').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Follow up: Jo')
    await click(save())
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload.next_step).toBe('scheduled')
    expect(payload.follow_up).toBeUndefined()
  })
})

describe('QuickActions: Move stage', () => {
  it('shows eight targets with the current column marked, and sends set_stage', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'Application/Estimate Sent' })
    await click(byLabel('Move stage'))
    const options = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')]
    expect(options.map((b) => b.textContent.replace('Now', ''))).toEqual([
      'New Lead', 'Attempted', 'Contacted/Working', 'Estimate Sent', 'Application Sent', 'Application Received', 'Nurture / Credit Repair', 'Lost',
    ])
    expect(options.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.replace('Now', '')))
      .toEqual(['Estimate Sent', 'Application Sent'])
    await click(options[2])
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', contact_id: 'c1', payload: { target: 'working' } })
    expect(document.body.textContent).toContain('Stage moved in FollowUpBoss')
  })

  it('offers a follow-up when the move leaves nothing scheduled, and Skip closes it', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'New Lead', openTaskCount: 0 })
    await click(byLabel('Move stage'))
    await click(byText('Attempted'))
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Next step for Jo?')
    expect(byText('Schedule follow-up')).toBeTruthy()
    await click(byText('Skip'))
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('does not prompt when a task is already open or the lead is parked', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'New Lead', openTaskCount: 2 })
    await click(byLabel('Move stage'))
    await click(byText('Attempted'))
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    document.body.innerHTML = ''
    await mount({ ...bay, stage: 'New Lead', openTaskCount: 0 })
    await click(byLabel('Move stage'))
    await click(byText('Nurture / Credit Repair'))
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('asks why before marking Lost, then sends the reason', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }, { step: 'add_note', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'Attempted', openTaskCount: 0 })
    await click(byLabel('Move stage'))
    await click(byText('Lost'))
    expect(invoke).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Why is this lead lost?')
    await click(byText('Went elsewhere'))
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', payload: { target: 'lost', reason: 'Went elsewhere' } })
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('is not offered for MPG or without a board stage', async () => {
    await mount({ ...bay, stage: null })
    expect(byLabel('Move stage')).toBe(null)
  })
})
