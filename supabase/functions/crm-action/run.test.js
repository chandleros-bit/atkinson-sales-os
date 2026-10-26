import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from './run.ts'
import { mapActivity as fubMapActivity } from '../_shared/fub-activity.ts'
import { mapTask as fubMapTask } from '../_shared/fub-tasks.ts'
import { mapActivity as zohoMapActivity } from '../_shared/zoho-activity.ts'
import { mapTask as zohoMapTask } from '../_shared/zoho-tasks.ts'

// --- In-memory stand-in for the slice of supabase-js that run.ts uses -------
function fakeDb(seed) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  const failUpsert = new Set()
  const calls = []
  const db = {
    tables,
    calls,
    failUpsertOn: (t) => failUpsert.add(t),
    from(table) {
      tables[table] ??= []
      const filters = []
      let op = 'select'
      let payload = null
      let opts = null
      const match = (r) => filters.every(([c, v]) => r[c] === v)
      const exec = () => {
        const rows = tables[table]
        if (op === 'insert') {
          if (table === 'crm_actions' && rows.some((r) => r.client_action_id === payload.client_action_id)) {
            return { error: { code: '23505', message: 'duplicate key' } }
          }
          rows.push({ ...payload })
          return { error: null }
        }
        if (op === 'update') {
          rows.filter(match).forEach((r) => Object.assign(r, payload))
          return { error: null }
        }
        if (op === 'upsert') {
          if (failUpsert.has(table)) return { error: { message: 'mirror down' } }
          const keys = opts.onConflict.split(',')
          const i = rows.findIndex((r) => keys.every((k) => r[k] === payload[k]))
          if (i >= 0) rows[i] = { ...rows[i], ...payload }
          else rows.push({ ...payload })
          return { error: null }
        }
        return { data: rows.filter(match), error: null }
      }
      const q = {
        select: () => q,
        insert: (row) => { op = 'insert'; payload = row; calls.push(['insert', table, row]); return q },
        update: (patch) => { op = 'update'; payload = patch; calls.push(['update', table, patch]); return q },
        upsert: (row, o) => { op = 'upsert'; payload = row; opts = o; calls.push(['upsert', table, row, o]); return q },
        eq: (c, v) => { filters.push([c, v]); return q },
        maybeSingle: async () => {
          const r = exec()
          return { data: r.data?.[0] ?? null, error: r.error }
        },
        then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
      }
      return q
    },
  }
  return db
}

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const seed = () => ({
  settings: [{ key: 'writeback_enabled', value: { bay: true, mpg: true } }],
  contacts: [
    { id: 'c-bay', business_id: 'bay', source_crm: 'fub', external_id: '4821', name: 'Jo Ramirez', phone: '713-555-0142' },
    { id: 'c-nophone', business_id: 'bay', source_crm: 'fub', external_id: '4822', name: 'No Phone', phone: null },
    { id: 'c-mpg', business_id: 'mpg', source_crm: 'zoho', external_id: 'L555', name: 'Ana Ruiz', phone: null },
  ],
  tasks: [
    { id: 't-open', business_id: 'bay', source_crm: 'fub', external_id: '9001', contact_id: 'c-bay', deal_id: null, title: 'Call Jo', task_type: 'Call', is_completed: false },
    { id: 't-done', business_id: 'bay', source_crm: 'fub', external_id: '9002', contact_id: 'c-bay', deal_id: null, title: 'Old', task_type: 'Call', is_completed: true },
  ],
  activities: [],
  crm_actions: [],
  deals: [],
})

// Fake FUB adapter: scripted sends, read-backs shaped like FUB's API, and the
// REAL sync mappers so the mirror test proves the namespacing rule.
function fubAdapter(overrides = {}) {
  const sent = []
  const send = {
    logCall: vi.fn(async (a) => { sent.push(['logCall', a]); return { id: 48213 } }),
    addNote: vi.fn(async (a) => { sent.push(['addNote', a]); return { id: 777 } }),
    createTask: vi.fn(async (a) => { sent.push(['createTask', a]); return { id: 9100 } }),
    completeTask: vi.fn(async (a) => { sent.push(['completeTask', a]); return { id: Number(a.externalId) } }),
    pushTask: vi.fn(async (a) => { sent.push(['pushTask', a]); return { id: Number(a.externalId) } }),
    ...overrides,
  }
  const read = {
    call: async (id) => ({ id, personId: 4821, isIncoming: false, outcome: 'Left Message', created: '2026-10-18T15:00:00Z' }),
    note: async (id) => ({ id, personId: 4821, body: 'Asked for W-2s', created: '2026-10-18T15:00:00Z' }),
    task: async (id) => ({
      id, personId: 4821, name: 'Follow up: Jo', type: 'Follow Up', dueDate: '2026-10-19',
      isCompleted: String(id) === '9001',
    }),
  }
  return { sent, send, read, map: { activity: fubMapActivity, task: fubMapTask }, whoami: async () => ({ id: 12, name: 'Chandler' }) }
}

function zohoAdapter() {
  return {
    send: {
      logCall: vi.fn(async () => ({ id: 'Z-CALL-1' })),
      addNote: vi.fn(async () => ({ id: 'Z-NOTE-1' })),
      createTask: vi.fn(async () => ({ id: 'Z-TASK-1' })),
      completeTask: vi.fn(async (a) => ({ id: a.externalId })),
      pushTask: vi.fn(async (a) => ({ id: a.externalId })),
    },
    read: {
      call: async (id) => ({ id, Call_Type: 'Outbound', Call_Start_Time: '2026-10-18T14:54:00+00:00', What_Id: { id: 'L555' }, $se_module: 'Leads', Description: 'Interested' }),
      note: async (id) => ({ id, Note_Content: 'x', Parent_Id: { id: 'L555' }, $se_module: 'Leads', Created_Time: '2026-10-18T15:00:00+00:00' }),
      task: async (id) => ({ id, Subject: 'Follow up: Ana', Due_Date: '2026-10-20', Status: 'Not Started', What_Id: { id: 'L555' }, $se_module: 'Leads' }),
    },
    map: { activity: zohoMapActivity, task: zohoMapTask },
  }
}

const logCallReq = (extra = {}) => ({
  client_action_id: uuid(1),
  action: 'log_call',
  contact_id: 'c-bay',
  payload: { outcome: 'Left Message', duration_min: 1, ...extra },
})

let db
let bay
let mpg
const now = new Date('2026-10-18T15:00:00Z')
const go = (req, extra = {}) => run(req, { db, adapters: { bay, mpg }, allowedUserId: USER, userId: USER, now, ...extra })

beforeEach(() => {
  db = fakeDb(seed())
  bay = fubAdapter()
  mpg = zohoAdapter()
})

describe('crm-action run: guards', () => {
  it('403s a signed-in user who is not ALLOWED_USER_ID and writes nothing', async () => {
    const res = await go(logCallReq(), { userId: 'someone-else' })
    expect(res.http).toBe(403)
    expect(db.calls).toEqual([])
    expect(bay.send.logCall).not.toHaveBeenCalled()
  })

  it('403s when ALLOWED_USER_ID is not configured', async () => {
    expect((await go(logCallReq(), { allowedUserId: undefined })).http).toBe(403)
  })

  it('400s without a uuid client_action_id', async () => {
    expect((await go({ ...logCallReq(), client_action_id: 'nope' })).http).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('refuses and records when the book\'s write-back flag is off', async () => {
    db.tables.settings[0].value = { bay: false, mpg: false }
    const res = await go(logCallReq())
    expect(res.body).toEqual({ status: 'refused', error: 'Write-back is off for Bayway' })
    expect(bay.send.logCall).not.toHaveBeenCalled()
    expect(db.tables.crm_actions[0]).toMatchObject({ status: 'refused', action: 'log_call', business_id: 'bay', user_id: USER })
  })

  it('refuses a call to a contact with no phone', async () => {
    const res = await go({ ...logCallReq(), contact_id: 'c-nophone' })
    expect(res.body).toEqual({ status: 'refused', error: 'No phone on file in FUB' })
    expect(bay.send.logCall).not.toHaveBeenCalled()
  })

  it('refuses completing a task that is already done', async () => {
    const res = await go({ client_action_id: uuid(2), action: 'complete_task', task_id: 't-done', payload: {} })
    expect(res.body.status).toBe('refused')
    expect(bay.send.completeTask).not.toHaveBeenCalled()
  })

  it('refuses an unknown contact without a crm_actions row', async () => {
    const res = await go({ ...logCallReq(), contact_id: 'missing' })
    expect(res.body).toEqual({ status: 'refused', error: 'Contact not found' })
    expect(db.tables.crm_actions).toEqual([])
  })

  it('returns whoami without writing anything', async () => {
    const res = await go({ client_action_id: uuid(3), action: 'whoami' })
    expect(res.body).toEqual({ status: 'ok', whoami: { id: 12, name: 'Chandler' } })
    expect(db.calls).toEqual([])
  })
})

describe('crm-action run: idempotency', () => {
  it('logs one call when the same submit arrives twice', async () => {
    const first = await go(logCallReq())
    const second = await go(logCallReq())
    expect(bay.send.logCall).toHaveBeenCalledTimes(1)
    expect(second.body).toEqual({ ...first.body, replay: true })
    expect(db.tables.crm_actions).toHaveLength(1)
  })

  it('reports pending to a duplicate that lands while the first is still running', async () => {
    let release
    bay.send.logCall.mockImplementationOnce(() => new Promise((r) => { release = () => r({ id: 1 }) }))
    const first = go(logCallReq())
    await new Promise((r) => setTimeout(r, 0))
    const dup = await go(logCallReq())
    expect(dup.body).toMatchObject({ status: 'pending', replay: true })
    release()
    await first
    expect(bay.send.logCall).toHaveBeenCalledTimes(1)
  })
})

describe('crm-action run: Bayway steps and mirror', () => {
  it('runs call, complete, follow-up in order and mirrors through the sync mappers', async () => {
    const res = await go(logCallReq({
      note: 'vm',
      complete_task_id: 't-open',
      follow_up: { due_date: '2026-10-19', title: 'Follow up: Jo', type: 'Follow Up' },
    }))
    expect(res.http).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(bay.sent.map((s) => s[0])).toEqual(['logCall', 'completeTask', 'createTask'])
    expect(bay.sent[0][1]).toEqual({ externalId: '4821', phone: '713-555-0142', outcome: 'Left Message', note: 'vm', durationMin: 1 })
    expect(res.body.results.map((r) => [r.step, r.ok, r.crm_id])).toEqual([
      ['log_call', true, 48213], ['complete_task', true, 9001], ['create_task', true, 9100],
    ])

    // Namespacing rule: the call mirror is call-<id>, exactly what the sync writes.
    const [call] = db.tables.activities
    expect(call).toMatchObject({ external_id: 'call-48213', source_crm: 'fub', type: 'call', direction: 'outbound', contact_id: 'c-bay' })
    expect(db.calls.find((c) => c[0] === 'upsert' && c[1] === 'activities')[3]).toEqual({ onConflict: 'source_crm,external_id' })

    // Completed task flipped through mapTask; new task inserted with its FUB id.
    expect(db.tables.tasks.find((t) => t.external_id === '9001').is_completed).toBe(true)
    expect(db.tables.tasks.find((t) => t.external_id === '9100')).toMatchObject({ contact_id: 'c-bay', is_completed: false })

    expect(db.tables.contacts.find((c) => c.id === 'c-bay').last_touch_at).toBe('2026-10-18T15:00:00.000Z')
    expect(db.tables.crm_actions[0]).toMatchObject({ status: 'ok' })
  })

  it('a second mirror of the same call upserts onto one row, like the next sync', async () => {
    await go(logCallReq())
    // Simulate the scheduled sync writing the same FUB call.
    const syncRow = fubMapActivity({ id: 48213, personId: 4821, isIncoming: false, created: '2026-10-18T15:00:00Z' }, 'call', new Map([['4821', 'c-bay']]))
    await db.from('activities').upsert(syncRow, { onConflict: 'source_crm,external_id' })
    expect(db.tables.activities.filter((a) => a.external_id === 'call-48213')).toHaveLength(1)
  })

  it('stops after a failed call and writes no mirror', async () => {
    bay.send.logCall.mockRejectedValueOnce(new Error('FUB POST /calls -> 500: down'))
    const res = await go(logCallReq({ follow_up: { due_date: '2026-10-19', title: 'F' } }))
    expect(res.body).toEqual({ status: 'error', results: [{ step: 'log_call', ok: false, error: 'FUB POST /calls -> 500: down' }] })
    expect(bay.send.createTask).not.toHaveBeenCalled()
    expect(db.tables.activities).toEqual([])
    expect(db.tables.contacts.find((c) => c.id === 'c-bay').last_touch_at).toBeUndefined()
    expect(db.tables.crm_actions[0].status).toBe('error')
  })

  it('reports partial when the call works and the follow-up fails', async () => {
    bay.send.createTask.mockRejectedValueOnce(new Error('FUB POST /tasks -> 422: bad'))
    const res = await go(logCallReq({ follow_up: { due_date: '2026-10-19', title: 'F' } }))
    expect(res.body.status).toBe('partial')
    expect(res.body.results[1]).toEqual({ step: 'create_task', ok: false, error: 'FUB POST /tasks -> 422: bad' })
    expect(db.tables.activities).toHaveLength(1)
  })

  it('reports success when only the mirror fails', async () => {
    db.failUpsertOn('activities')
    const res = await go(logCallReq())
    expect(res.body.status).toBe('ok')
    expect(res.body.results[0]).toMatchObject({ ok: true, mirror_error: 'activities upsert: mirror down' })
  })

  it('mirrors a note as note-<id>', async () => {
    const res = await go({ client_action_id: uuid(4), action: 'add_note', contact_id: 'c-bay', payload: { body: 'Asked for W-2s' } })
    expect(res.body.status).toBe('ok')
    expect(db.tables.activities[0]).toMatchObject({ external_id: 'note-777', type: 'note' })
  })

  it('pushes a task and passes the reschedule flag through', async () => {
    bay.send.pushTask.mockResolvedValueOnce({ id: 9300, also: [9001], rescheduled: true })
    const res = await go({ client_action_id: uuid(5), action: 'push_task', task_id: 't-open', payload: { due_date: '2026-10-21' } })
    expect(bay.send.pushTask).toHaveBeenCalledWith({ externalId: '9001', dueDate: '2026-10-21', contactExternalId: '4821', title: 'Call Jo', type: 'Call' })
    expect(res.body.results[0]).toMatchObject({ step: 'push_task', ok: true, crm_id: 9300, rescheduled: true })
    expect(db.tables.tasks.map((t) => t.external_id).sort()).toEqual(['9001', '9002', '9300'])
  })
})

describe('crm-action run: MPG mirror', () => {
  it('mirrors a Zoho call as call-<id> on the lead\'s contact', async () => {
    const res = await go({ client_action_id: uuid(6), action: 'log_call', contact_id: 'c-mpg', payload: { outcome: 'Interested', duration_min: 5 } })
    expect(res.body.status).toBe('ok')
    expect(db.tables.activities[0]).toMatchObject({ external_id: 'call-Z-CALL-1', source_crm: 'zoho', direction: 'outbound', contact_id: 'c-mpg' })
  })

  it('mirrors a Zoho task on the lead to its contact', async () => {
    await go({ client_action_id: uuid(7), action: 'create_task', contact_id: 'c-mpg', payload: { due_date: '2026-10-20', title: 'Follow up: Ana' } })
    expect(db.tables.tasks.find((t) => t.external_id === 'Z-TASK-1')).toMatchObject({ contact_id: 'c-mpg', business_id: 'mpg' })
  })

  it('does not need a phone for an MPG call', async () => {
    expect((await go({ client_action_id: uuid(8), action: 'log_call', contact_id: 'c-mpg', payload: { outcome: 'Busy' } })).body.status).toBe('ok')
  })
})

describe('crm-action run: smart_lists', () => {
  it('returns the adapter summary for the allowed user and writes nothing', async () => {
    bay.smartLists = async () => ({ lists: [{ id: 1, name: '01' }] })
    const res = await go({ client_action_id: uuid(9), action: 'smart_lists' })
    expect(res.body).toEqual({ status: 'ok', smart_lists: { lists: [{ id: 1, name: '01' }] } })
    expect(db.calls).toEqual([])
  })
  it('403s anyone else', async () => {
    expect((await go({ client_action_id: uuid(9), action: 'smart_lists' }, { userId: 'x' })).http).toBe(403)
  })
})

describe('crm-action run: set_stage (Bayway stage tags)', () => {
  // Stand-in for fub.ts mapContact: the fields run.ts relies on.
  const mapContact = (p) => ({ business_id: 'bay', source_crm: 'fub', external_id: String(p.id), name: p.name, phone: null, person_stage: p.stage, raw: p })
  const stageReq = (contactId, target, n = 20) => ({ client_action_id: uuid(n), action: 'set_stage', contact_id: contactId, payload: { target } })

  beforeEach(() => {
    db.tables.contacts.push(
      { id: 'c-lead', business_id: 'bay', source_crm: 'fub', external_id: '5001', name: 'Lead One', phone: '1', person_stage: 'Lead' },
      { id: 'c-pq', business_id: 'bay', source_crm: 'fub', external_id: '5002', name: 'Pre Qual', phone: '1', person_stage: 'Pre-Qualified' },
      { id: 'c-nur', business_id: 'bay', source_crm: 'fub', external_id: '5003', name: 'Nurt', phone: '1', person_stage: 'Nurture' },
    )
    bay.send.setStage = vi.fn(async ({ externalId, target }) => ({ id: externalId, tags: ['Active', 'Working Estimate'], target }))
    bay.read.person = async (id) => ({ id, name: 'Lead One', stage: 'Lead', tags: ['Active', 'Working Estimate'] })
    bay.map.contact = mapContact
  })

  it('moves a Lead, then mirrors the person back through the people mapper', async () => {
    const res = await go(stageReq('c-lead', 'working'))
    expect(res.body.status).toBe('ok')
    expect(bay.send.setStage).toHaveBeenCalledWith({ externalId: '5001', target: 'working' })
    const row = db.tables.contacts.find((c) => c.external_id === '5001')
    expect(row.raw.tags).toEqual(['Active', 'Working Estimate'])
    expect(db.calls.find((c) => c[0] === 'upsert' && c[1] === 'contacts')[3]).toEqual({ onConflict: 'source_crm,external_id' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'set_stage', status: 'ok' })
  })

  it('refuses an unknown target', async () => {
    expect((await go(stageReq('c-lead', 'closed', 21))).body).toEqual({ status: 'refused', error: 'Unknown stage: closed' })
    expect(bay.send.setStage).not.toHaveBeenCalled()
  })

  it('refuses moving a Pre-Qualified lead below Application Received', async () => {
    const res = await go(stageReq('c-pq', 'attempted', 22))
    expect(res.body.status).toBe('refused')
    expect(res.body.error).toMatch(/Pre-Qualified/)
    expect((await go(stageReq('c-pq', 'application_received', 23))).body.status).toBe('ok')
    expect((await go(stageReq('c-pq', 'credit_repair', 26))).body.status).toBe('ok')
  })

  it('refuses a lead whose FUB stage keeps it off the board', async () => {
    const res = await go(stageReq('c-nur', 'attempted', 24))
    expect(res.body.error).toMatch(/Nurture/)
  })

  it('marks Lost with the reason as a FUB note, and reports where the lead was', async () => {
    bay.send.setStage = vi.fn(async ({ externalId }) => ({ id: externalId, tags: ['Lost'], previous: 'attempted' }))
    bay.read.person = async (id) => ({ id, name: 'Lead One', stage: 'Lead', tags: ['Lost'] })
    bay.read.note = async (id) => ({ id, personId: 5001, body: 'Marked Lost: Went elsewhere', created: '2026-10-20T15:00:00Z' })
    const res = await go({ ...stageReq('c-lead', 'lost', 40), payload: { target: 'lost', reason: 'Went elsewhere' } })
    expect(res.body.status).toBe('ok')
    expect(res.body.results.map((r) => r.step)).toEqual(['set_stage', 'add_note'])
    expect(res.body.results[0].previous_target).toBe('attempted')
    expect(bay.send.addNote).toHaveBeenCalledWith({ externalId: '5001', subject: null, body: 'Marked Lost: Went elsewhere' })
  })

  it('adds the Pre-Approved and Disclosed review tags, Pre-Qualified leads included', async () => {
    expect((await go(stageReq('c-lead', 'pre_approved', 42))).body.status).toBe('ok')
    expect((await go(stageReq('c-pq', 'disclosed', 43))).body.status).toBe('ok')
    expect(bay.send.setStage).toHaveBeenCalledWith({ externalId: '5002', target: 'disclosed' })
  })

  it('lets a Pre-Qualified lead be marked Lost', async () => {
    expect((await go(stageReq('c-pq', 'lost', 41))).body.status).toBe('ok')
  })

  it('refuses MPG', async () => {
    const res = await go(stageReq('c-mpg', 'attempted', 25))
    expect(res.body.error).toMatch(/Bayway only/)
  })

  const parkCall = (contactId, n) => ({
    client_action_id: uuid(n), action: 'log_call', contact_id: contactId,
    payload: { outcome: 'Not Interested', duration_min: 5, next_step: 'none', no_next_step_reason: 'Moving to Nurture', set_stage: 'credit_repair' },
  })

  it('logs the call, then parks the lead in Nurture', async () => {
    const res = await go(parkCall('c-lead', 30))
    expect(res.body.status).toBe('ok')
    expect(res.body.results.map((r) => r.step)).toEqual(['log_call', 'set_stage'])
    expect(bay.send.logCall).toHaveBeenCalled()
    expect(bay.send.setStage).toHaveBeenCalledWith({ externalId: '5001', target: 'credit_repair' })
    expect(db.tables.crm_actions.at(-1).request.payload).toMatchObject({ no_next_step_reason: 'Moving to Nurture' })
  })

  it('refuses a Nurture park for MPG before anything is sent', async () => {
    const res = await go({ ...parkCall('c-mpg', 31), payload: { ...parkCall('c-mpg', 31).payload, set_stage: 'credit_repair' } })
    expect(res.body.status).toBe('refused')
    expect(res.body.error).toMatch(/Bayway only/)
    expect(mpg.send.logCall).not.toHaveBeenCalled()
  })

  it('does not park when the call itself fails', async () => {
    bay.send.logCall = vi.fn(async () => { throw new Error('FUB POST /calls -> 500: down') })
    const res = await go(parkCall('c-lead', 32))
    expect(res.body.status).toBe('error')
    expect(bay.send.setStage).not.toHaveBeenCalled()
  })
})

describe('crm-action run: create_contact (new lead)', () => {
  const createReq = (business_id, payload, n) => ({ client_action_id: uuid(n), action: 'create_contact', business_id, payload })
  const fubPerson = (id) => ({ id, name: 'Sam Lee', firstName: 'Sam', lastName: 'Lee', stage: 'Lead', tags: [], phones: [{ value: '7135550100' }], emails: [], assignedUserId: 12 })
  const zohoLead = (id) => ({ id, First_Name: 'Ana', Last_Name: 'Ruiz', Company: 'Ruiz Deli', Lead_Status: 'Not Contacted', Phone: null, Email: 'ana@example.com' })

  beforeEach(() => {
    db.tables.settings.push({ key: 'create_lead_enabled', value: { bay: true, mpg: true } })
    bay.send.createContact = vi.fn(async () => ({ id: 6001 }))
    bay.read.person = async (id) => fubPerson(id)
    bay.read.note = async (id) => ({ id, personId: 6001, body: 'Met at open house', created: '2026-10-20T15:00:00Z' })
    // id: the fake db doesn't generate one the way Postgres does.
    bay.map.contact = (p) => ({ id: `c-${p.id}`, business_id: 'bay', source_crm: 'fub', external_id: String(p.id), name: p.name, phone: p.phones?.[0]?.value || null, person_stage: p.stage, raw: p })
    mpg.send.createContact = vi.fn(async () => ({ id: 'Z-LEAD-9' }))
    mpg.read.lead = async (id) => zohoLead(id)
    mpg.map.contact = (r) => ({ id: `c-${r.id}`, business_id: 'mpg', source_crm: 'zoho', external_id: String(r.id), name: 'Ana Ruiz', company: r.Company, person_stage: r.Lead_Status, raw: r })
  })

  it('creates a Bayway lead, mirrors it, and attaches the note to it', async () => {
    const res = await go(createReq('bay', { first_name: 'Sam', last_name: 'Lee', phone: '7135550100', email: '', note: 'Met at open house' }, 50))
    expect(res.body.status).toBe('ok')
    expect(bay.send.createContact).toHaveBeenCalledWith({ firstName: 'Sam', lastName: 'Lee', phone: '7135550100', email: '', company: '' })
    const row = db.tables.contacts.find((c) => c.external_id === '6001')
    expect(row).toMatchObject({ business_id: 'bay', name: 'Sam Lee', person_stage: 'Lead' })
    expect(res.body.results[0]).toMatchObject({ step: 'create_contact', ok: true, contact_id: 'c-6001' })
    expect(bay.send.addNote).toHaveBeenCalledWith({ externalId: '6001', subject: null, body: 'Met at open house' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'create_contact', business_id: 'bay', status: 'ok', contact_id: 'c-6001' })
  })

  it('creates an MPG lead through Zoho', async () => {
    const res = await go(createReq('mpg', { first_name: 'Ana', last_name: 'Ruiz', company: 'Ruiz Deli', email: 'ana@example.com' }, 51))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.createContact).toHaveBeenCalledWith({ firstName: 'Ana', lastName: 'Ruiz', phone: '', email: 'ana@example.com', company: 'Ruiz Deli' })
    expect(db.tables.contacts.find((c) => c.external_id === 'Z-LEAD-9')).toMatchObject({ business_id: 'mpg', company: 'Ruiz Deli' })
  })

  it('refuses a lead without the fields its CRM needs', async () => {
    expect((await go(createReq('bay', { first_name: 'Sam', last_name: 'Lee' }, 52))).body).toEqual({ status: 'refused', error: 'A new Bayway lead needs a phone or an email' })
    expect((await go(createReq('bay', { phone: '713' }, 53))).body.error).toBe('A new lead needs a name')
    expect((await go(createReq('mpg', { last_name: 'Ruiz' }, 54))).body.error).toBe('Zoho needs a company for a new lead')
    expect((await go(createReq('nope', { last_name: 'Ruiz' }, 55))).body.error).toBe('Unknown book: nope')
    expect(bay.send.createContact).not.toHaveBeenCalled()
  })

  it('refuses when new-lead create is switched off for the book', async () => {
    db.tables.settings.find((s) => s.key === 'create_lead_enabled').value = { bay: false, mpg: true }
    const res = await go(createReq('bay', { first_name: 'Sam', phone: '713' }, 56))
    expect(res.body).toEqual({ status: 'refused', error: 'New lead is off for Bayway' })
    expect(bay.send.createContact).not.toHaveBeenCalled()
  })

  it('does not add the note when the create fails', async () => {
    bay.send.createContact = vi.fn(async () => { throw new Error('Already in FollowUpBoss, assigned to another agent') })
    const res = await go(createReq('bay', { first_name: 'Sam', phone: '713', note: 'x' }, 57))
    expect(res.body.status).toBe('error')
    expect(res.body.results).toEqual([{ step: 'create_contact', ok: false, error: 'Already in FollowUpBoss, assigned to another agent' }])
    expect(bay.send.addNote).not.toHaveBeenCalled()
  })
})
