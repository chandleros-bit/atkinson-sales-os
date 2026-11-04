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
// contact_events inserts (a follow-up with a time goes on the Calendar).
const inserts = []
// lead_ratings upserts, and the rows a lead_ratings read returns.
const upserts = []
const ratingRows = { rows: [] }
// Next lead_ratings upsert fails with this message (null = succeed).
const upsertFail = { message: null }
// One timeline for the invoke mock and the upsert, to assert write order.
const events = []
// Write-back flags the settings read returns.
const flags = { bay: true, mpg: false }

function query(table) {
  const q = {}
  let future = false
  for (const m of ['select', 'eq', 'lte', 'order', 'limit', 'range']) q[m] = () => q
  q.gt = () => {
    future = true
    return q
  }
  q.insert = (row) => {
    inserts.push({ table, row })
    return q
  }
  q.upsert = async (row) => {
    upserts.push(row)
    events.push('upsert')
    return { error: upsertFail.message ? { message: upsertFail.message } : null }
  }
  q.single = async () => ({ data: { id: 'ev1' }, error: null })
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { ...flags } } : null, error: null })
  q.then = (resolve) =>
    resolve({ data: table === 'v_tasks' ? (future ? futureTasks.rows : openTasks.rows) : table === 'lead_ratings' ? ratingRows.rows : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: QuickActions } = await import('./QuickActions')
const { resetWritebackFlags } = await import('../lib/writeback')
const { default: Toaster } = await import('./Toaster')
const { __resetRatingsForTest } = await import('../lib/useLeadRatings')

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
  inserts.length = 0
  upserts.length = 0
  ratingRows.rows = []
  upsertFail.message = null
  events.length = 0
  flags.mpg = false
  __resetRatingsForTest()
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

  // Interested defaults to a "tomorrow" follow-up, so there is no date to pick.
  const pickDate = async () => {}
  const tempOk = () => invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }, error: null })

  it('offers Hot / Warm / Cold only after a conversation, and saves the rating with the call', async () => {
    ok()
    tempOk()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('No Answer'))
    expect(document.querySelector('[aria-label="Temperature"]')).toBe(null)
    await click(byText('Interested'))
    await click(byText('Hot'))
    await type(byLabel('Estimated loan amount'), '350,000')
    await pickDate()
    await click(save())
    expect(invoke.mock.calls[0][1].body.action).toBe('log_call')
    expect(upserts[0]).toMatchObject({ contact_id: 'c1', business_id: 'bay', temperature: 'hot', est_amount: 350000 })
    expect('close_month' in upserts[0]).toBe(false)
    expect(invoke.mock.calls[1][1].body).toMatchObject({ action: 'set_temperature', payload: { temperature: 'hot' } })
  })

  it('a call with no temperature picked saves no rating', async () => {
    ok()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await pickDate()
    await click(save())
    expect(upserts).toEqual([])
  })

  it('a blank amount does not wipe the amount already saved on the lead', async () => {
    ratingRows.rows = [{ contact_id: 'c1', business_id: 'bay', temperature: 'hot', est_amount: 400000, close_month: null }]
    ok()
    tempOk()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Warm'))
    await pickDate()
    await click(save())
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ contact_id: 'c1', temperature: 'warm' })
    expect('est_amount' in upserts[0]).toBe(false)
    expect('close_month' in upserts[0]).toBe(false)
  })

  it('does not save a rating when the call itself fails', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'error', results: [{ step: 'log_call', ok: false, error: 'FUB 500' }] }, error: null })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    await click(save())
    expect(upserts).toEqual([])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('toasts when the FUB tag is not updated', async () => {
    ok()
    invoke.mockResolvedValueOnce({ data: { status: 'error', results: [{ step: 'set_temperature', ok: false, error: 'FUB 500' }] }, error: null })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Cold'))
    await click(save())
    expect(upserts[0]).toMatchObject({ temperature: 'cold' })
    expect(document.body.textContent).toContain('Temperature saved; FUB tag not updated')
  })

  it('saves the rating only after the call is logged: log_call, then the row, then the FUB tag', async () => {
    invoke.mockImplementation(async (_, { body }) => {
      events.push(body.action)
      return { data: { status: 'ok', results: [{ step: body.action, ok: true }] }, error: null }
    })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    await click(save())
    expect(events).toEqual(['log_call', 'upsert', 'set_temperature'])
  })

  it('a temperature picked and then an unanswered outcome saves nothing', async () => {
    ok()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    await click(byText('No Answer'))
    expect(document.querySelector('[aria-label="Temperature"]')).toBe(null)
    await click(save())
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(upserts).toEqual([])
  })

  it('an MPG lead gets no amount field and no est_amount', async () => {
    flags.mpg = true
    ok()
    await mount({ ...bay, businessId: 'mpg' })
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    expect(byLabel('Estimated loan amount')).toBe(null)
    await click(save())
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ business_id: 'mpg', temperature: 'hot' })
    expect('est_amount' in upserts[0]).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('a typed 0 is not an amount, and the field is length-capped', async () => {
    ok()
    tempOk()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    expect(byLabel('Estimated loan amount').maxLength).toBe(12)
    await type(byLabel('Estimated loan amount'), '0')
    await click(save())
    expect('est_amount' in upserts[0]).toBe(false)
  })

  it('saves no rating when log_call itself failed, even if another step went through', async () => {
    invoke.mockResolvedValueOnce({
      data: { status: 'partial', results: [{ step: 'log_call', ok: false, error: 'FUB 500' }, { step: 'create_task', ok: true }] },
      error: null,
    })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    await click(save())
    expect(upserts).toEqual([])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('saves no rating when the contact was removed in FUB', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'partial', results: [{ step: 'log_call', ok: false, contact_removed: true, error: 'Deleted in FollowUpBoss' }] }, error: null })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    await click(save())
    expect(upserts).toEqual([])
  })

  it('still saves the rating when the call logged but the follow-up task failed', async () => {
    invoke.mockResolvedValueOnce({
      data: { status: 'partial', results: [{ step: 'log_call', ok: true }, { step: 'create_task', ok: false, error: 'FUB 422' }] },
      error: null,
    })
    tempOk()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Hot'))
    await click(save())
    expect(upserts).toHaveLength(1)
  })

  it('offers Retry when the rating does not save, and Retry saves it', async () => {
    ok()
    tempOk()
    upsertFail.message = 'RLS denied'
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await click(byText('Warm'))
    await click(save())
    expect(document.body.textContent).toContain('Temperature not saved: RLS denied')
    expect(upserts).toHaveLength(1)
    upsertFail.message = null
    await click(byText('Retry'))
    expect(upserts).toHaveLength(2)
    expect(upserts[1]).toMatchObject({ contact_id: 'c1', temperature: 'warm' })
  })

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
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ no_next_step_reason: 'Moving to Nurture', set_stage: 'nurture' })
  })

  it('on the call cadence, an unanswered call defaults to the next attempt and writes no task', async () => {
    ok()
    await mount({ ...bay, stage: 'Attempted' })
    await click(byLabel('Log call'))
    await click(byText('No Answer'))
    expect(document.querySelector('[aria-label="Next step"]').textContent).toContain('Next call attempt')
    expect(save().disabled).toBe(false)
    await click(save())
    const payload = invoke.mock.calls[0][1].body.payload
    expect(payload).toMatchObject({ outcome: 'No Answer', next_step: 'cadence' })
    expect(payload.follow_up).toBeUndefined()
  })

  it('a caller can say the lead is on the cadence (MPG has no board stage); a worked lead is not', async () => {
    ok()
    await mount({ ...bay, cadence: true })
    await click(byLabel('Log call'))
    await click(byText('Left Message'))
    await click(save())
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ next_step: 'cadence' })
    document.body.innerHTML = ''
    await mount({ ...bay, stage: 'Contacted/Working' })
    await click(byLabel('Log call'))
    expect(document.body.textContent).not.toContain('Next call attempt')
  })

  it('moves a New Lead to Attempted with the call, and says so first', async () => {
    ok()
    await mount({ ...bay, stage: 'New Lead' })
    await click(byLabel('Log call'))
    expect(document.querySelector('[data-stage-advance]').textContent).toContain('from New Lead to Attempted')
    await click(byText('No Answer'))
    await click(save())
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ outcome: 'No Answer', set_stage: 'attempted' })
  })

  it('leaves a lead past New Lead where it is', async () => {
    ok()
    await mount({ ...bay, stage: 'Contacted/Working' })
    await click(byLabel('Log call'))
    expect(document.querySelector('[data-stage-advance]')).toBeNull()
    await click(byText('No Answer'))
    await click(save())
    expect(invoke.mock.calls[0][1].body.payload.set_stage).toBeUndefined()
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

describe('QuickActions: Schedule follow-up', () => {
  const ok = { data: { status: 'ok', results: [{ step: 'create_task', ok: true }] }, error: null }
  const pad = (n) => String(n).padStart(2, '0')
  const todayKey = () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  it('offers Today first and schedules the task for today in one click', async () => {
    invoke.mockResolvedValueOnce(ok)
    await mount(bay)
    await click(byLabel('Schedule follow-up'))
    const chips = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')].map((b) => b.textContent)
    expect(chips.slice(0, 5)).toEqual(['Today', 'Tomorrow', 'In 3 days', 'Next Monday', 'Pick a date'])
    await click(byText('Today'))
    await click(byText('Schedule follow-up'))
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'create_task', payload: { due_date: todayKey() } })
  })

  it('keeps a follow-up without a time off the Calendar', async () => {
    invoke.mockResolvedValueOnce(ok)
    await mount(bay)
    await click(byLabel('Schedule follow-up'))
    await click(byText('Schedule follow-up'))
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(inserts).toEqual([])
  })

  it('puts a follow-up with a time on the Calendar once the task is saved', async () => {
    invoke.mockResolvedValueOnce(ok)
    await mount(bay)
    await click(byLabel('Schedule follow-up'))
    await click(byText('Pick a date'))
    await type(byLabel('Follow-up date'), '2099-03-04')
    await type(byLabel('Follow-up time'), '14:30')
    await click(byText('Schedule follow-up'))
    expect(invoke.mock.calls[0][1].body.payload.due_date).toBe('2099-03-04')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('contact_events')
    expect(inserts[0].row).toMatchObject({
      business_id: 'bay',
      contact_id: 'c1',
      kind: 'follow_up',
      starts_at: new Date(2099, 2, 4, 14, 30).toISOString(),
      duration_min: 15,
      note: 'Follow up: Jo',
    })
  })

  it('refuses a time already past today, before anything is sent', async () => {
    await mount(bay)
    await click(byLabel('Schedule follow-up'))
    await click(byText('Today'))
    await type(byLabel('Follow-up time'), '00:00')
    await click(byText('Schedule follow-up'))
    expect(invoke).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]').textContent).toContain('That time is in the past')
  })

  it('does not add the Calendar entry when the task fails', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'error', results: [{ step: 'create_task', ok: false, error: 'FUB 422' }] }, error: null })
    await mount(bay)
    await click(byLabel('Schedule follow-up'))
    await click(byText('Pick a date'))
    await type(byLabel('Follow-up date'), '2099-03-04')
    await type(byLabel('Follow-up time'), '09:00')
    await click(byText('Schedule follow-up'))
    expect(inserts).toEqual([])
  })

  it('adds the Calendar entry from Log call once a retried follow-up saves', async () => {
    invoke.mockResolvedValueOnce({
      data: { status: 'partial', results: [{ step: 'log_call', ok: true }, { step: 'create_task', ok: false, error: 'FUB 422' }] },
      error: null,
    })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('No Answer'))
    await click(byText('Pick a date'))
    await type(byLabel('Follow-up date'), '2099-03-04')
    await type(byLabel('Follow-up time'), '10:15')
    await click(byText('Log call'))
    expect(inserts).toEqual([])
    invoke.mockResolvedValueOnce(ok)
    await click(byText('Retry follow-up'))
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row).toMatchObject({ kind: 'follow_up', starts_at: new Date(2099, 2, 4, 10, 15).toISOString() })
  })
})

describe('QuickActions: Move stage', () => {
  it('shows every target with the current column marked, and sends set_stage', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'Application/Estimate Sent' })
    await click(byLabel('Move stage'))
    const options = [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')]
    expect(options.map((b) => b.textContent.replace('Now', ''))).toEqual([
      'New Lead', 'Attempted', 'Contacted/Working', 'Estimate Sent', 'Application Sent', 'Application Received', 'Disclosed', 'Nurture', 'Credit Repair', 'Lost',
    ])
    expect(options.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.replace('Now', '')))
      .toEqual(['Estimate Sent', 'Application Sent'])
    await click(options[2])
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', contact_id: 'c1', payload: { target: 'working' } })
    expect(document.body.textContent).toContain('Stage moved in FollowUpBoss')
  })

  it('offers a follow-up when the move leaves nothing scheduled, and Skip closes it', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'Attempted', openTaskCount: 0 })
    await click(byLabel('Move stage'))
    await click(byText('Contacted/Working'))
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
    await click(byText('Nurture'))
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    expect(invoke.mock.calls.at(-1)[1].body.payload).toEqual({ target: 'nurture' })
  })

  it('does not prompt for a move onto the call cadence: the next attempt is the next step', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'New Lead', openTaskCount: 0 })
    await click(byLabel('Move stage'))
    await click(byText('Attempted'))
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    expect(invoke.mock.calls.at(-1)[1].body.payload).toEqual({ target: 'attempted' })
  })

  it('asks why before marking Lost, then sends the reason', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_stage', ok: true }, { step: 'add_note', ok: true }] }, error: null })
    await mount({ ...bay, stage: 'Attempted', openTaskCount: 0 })
    await click(byLabel('Move stage'))
    await click(byText('Lost'))
    expect(invoke).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Why is this lead lost?')
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Only the FUB account owner can move it back')
    await click(byText('Went elsewhere'))
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'set_stage', payload: { target: 'lost', reason: 'Went elsewhere' } })
    expect(document.querySelector('[role="dialog"]')).toBe(null)
  })

  it('is not offered for MPG or without a board stage', async () => {
    await mount({ ...bay, stage: null })
    expect(byLabel('Move stage')).toBe(null)
  })
})
