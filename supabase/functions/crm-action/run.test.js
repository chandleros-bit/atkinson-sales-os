import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from './run.ts'
import { mapActivity as fubMapActivity } from '../_shared/fub-activity.ts'
import { mapTask as fubMapTask } from '../_shared/fub-tasks.ts'
import { mapActivity as zohoMapActivity } from '../_shared/zoho-activity.ts'
import { mapTask as zohoMapTask } from '../_shared/zoho-tasks.ts'
import { mapContact as zohoMapContact } from '../_shared/zoho.ts'

// --- In-memory stand-in for the slice of supabase-js that run.ts uses -------
function fakeDb(seed) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  const failUpsert = new Set()
  const failUpdate = new Map()
  const calls = []
  // Postgres fills these ids by default; the fake does it for the tables a
  // test reads an id back from.
  const AUTO_ID = new Set(['contacts', 'crm_actions'])
  let nextId = 0
  const withId = (table, r) => (AUTO_ID.has(table) && r.id == null ? { ...r, id: `${table}-${++nextId}` } : r)
  const db = {
    tables,
    calls,
    orExprs: [],
    failUpsertOn: (t) => failUpsert.add(t),
    // when(patch): which updates on the table fail (default: all of them).
    failUpdateOn: (t, when = () => true) => failUpdate.set(t, when),
    rpc: async (fn, args) => {
      calls.push(['rpc', fn, args])
      return { data: 1, error: null }
    },
    from(table) {
      tables[table] ??= []
      const filters = []
      let op = 'select'
      let payload = null
      let opts = null
      const match = (r) => filters.every((f) => f(r))
      const exec = () => {
        const rows = tables[table]
        if (op === 'insert') {
          if (table === 'crm_actions' && rows.some((r) => r.client_action_id === payload.client_action_id)) {
            return { error: { code: '23505', message: 'duplicate key' } }
          }
          for (const p of [].concat(payload)) rows.push(withId(table, { ...p }))
          return { error: null }
        }
        if (op === 'delete') {
          tables[table] = rows.filter((r) => !match(r))
          return { error: null }
        }
        if (op === 'update') {
          if (failUpdate.get(table)?.(payload)) return { error: { message: 'update down' } }
          const hit = rows.filter(match)
          hit.forEach((r) => Object.assign(r, payload))
          // The updated rows, as .update().select() returns them.
          return { data: hit.map((r) => ({ ...r })), error: null }
        }
        if (op === 'upsert') {
          if (failUpsert.has(table)) return { error: { message: 'mirror down' } }
          const keys = opts.onConflict.split(',')
          for (const p of [].concat(payload)) {
            const i = rows.findIndex((r) => keys.every((k) => r[k] === p[k]))
            if (i >= 0) rows[i] = { ...rows[i], ...p }
            else rows.push(withId(table, { ...p }))
          }
          return { error: null }
        }
        return { data: rows.filter(match), error: null }
      }
      const q = {
        select: () => q,
        insert: (row) => { op = 'insert'; payload = row; calls.push(['insert', table, row]); return q },
        update: (patch) => { op = 'update'; payload = patch; calls.push(['update', table, patch]); return q },
        delete: () => { op = 'delete'; calls.push(['delete', table]); return q },
        upsert: (row, o) => { op = 'upsert'; payload = row; opts = o; calls.push(['upsert', table, row, o]); return q },
        eq: (c, v) => { filters.push((r) => r[c] === v); return q },
        neq: (c, v) => { filters.push((r) => r[c] !== v); return q },
        // PostgREST or(): only "col.is.null" and "col.lt.<value>" are needed here.
        or: (expr) => {
          db.orExprs.push(expr)
          const parts = expr.split(',').map((s) => {
            const [c, o, ...v] = s.split('.')
            return [c, o, v.join('.').replace(/^"(.*)"$/, '$1')]
          })
          filters.push((r) => parts.some(([c, o, v]) => (o === 'is' && v === 'null' ? r[c] == null : o === 'lt' && r[c] != null && r[c] < v)))
          return q
        },
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

  it('removes a lead deleted in FUB from the dashboard and stops', async () => {
    bay.send.setStage = vi.fn(async () => {
      throw new Error('FUB GET /people/5001 -> 404: {"errorMessage":"Requested resource was not found."}')
    })
    const res = await go({ ...stageReq('c-lead', 'lost', 44), payload: { target: 'lost', reason: 'Not interested' } })
    expect(res.body.status).toBe('error')
    expect(res.body.results).toEqual([
      { step: 'set_stage', ok: false, contact_removed: true, error: 'This lead was deleted in FollowUpBoss, so it has been removed from the dashboard.' },
    ])
    expect(bay.send.addNote).not.toHaveBeenCalled()
    expect(db.calls.filter((c) => c[0] === 'rpc')).toEqual([['rpc', 'remove_fub_contacts', { ext_ids: ['5001'] }]])
  })

  it('keeps the lead when a FUB 404 is about something else', async () => {
    bay.send.setStage = vi.fn(async () => {
      throw new Error('FUB GET /people/9999 -> 404: {"errorMessage":"Requested resource was not found."}')
    })
    const res = await go(stageReq('c-lead', 'working', 45))
    expect(res.body.results[0]).toMatchObject({ ok: false })
    expect(res.body.results[0].contact_removed).toBeUndefined()
    expect(db.calls.some((c) => c[0] === 'rpc')).toBe(false)
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

describe('crm-action run: set_temperature (Bayway FUB tag)', () => {
  const mapContact = (p) => ({ business_id: 'bay', source_crm: 'fub', external_id: String(p.id), name: p.name, phone: null, person_stage: p.stage, raw: p })
  const tempReq = (contactId, temperature, n = 60) => ({ client_action_id: uuid(n), action: 'set_temperature', contact_id: contactId, payload: { temperature } })

  beforeEach(() => {
    db.tables.contacts.push(
      { id: 'c-t', business_id: 'bay', source_crm: 'fub', external_id: '6001', name: 'Temp Lead', phone: '1', person_stage: 'Lead' },
    )
    bay.send.setTemperature = vi.fn(async ({ externalId }) => ({ id: externalId, tags: ['Attempted', 'Hot'] }))
    bay.read.person = async (id) => ({ id, name: 'Temp Lead', stage: 'Lead', tags: ['Attempted', 'Hot'] })
    bay.map.contact = mapContact
  })

  it('writes the tag, then mirrors the person back', async () => {
    const res = await go(tempReq('c-t', 'hot'))
    expect(res.body.status).toBe('ok')
    expect(bay.send.setTemperature).toHaveBeenCalledWith({ externalId: '6001', temperature: 'hot' })
    expect(db.tables.contacts.find((c) => c.external_id === '6001').raw.tags).toEqual(['Attempted', 'Hot'])
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'set_temperature', status: 'ok' })
  })

  it('refuses an unknown temperature', async () => {
    expect((await go(tempReq('c-t', 'lukewarm', 61))).body).toEqual({ status: 'refused', error: 'Unknown temperature: lukewarm' })
    expect(bay.send.setTemperature).not.toHaveBeenCalled()
  })

  it('refuses MPG: temperature stays in the dashboard there', async () => {
    const res = await go(tempReq('c-mpg', 'hot', 62))
    expect(res.body.status).toBe('refused')
    expect(res.body.error).toMatch(/Bayway only/)
  })

  it('replays the stored reply when the same submit arrives twice', async () => {
    const first = await go(tempReq('c-t', 'hot', 63))
    const second = await go(tempReq('c-t', 'hot', 63))
    expect(bay.send.setTemperature).toHaveBeenCalledTimes(1)
    expect(second.body).toEqual({ ...first.body, replay: true })
    expect(db.tables.crm_actions.filter((r) => r.action === 'set_temperature')).toHaveLength(1)
  })

  it('refuses when Bayway write-back is off', async () => {
    db.tables.settings[0].value = { bay: false, mpg: false }
    const res = await go(tempReq('c-t', 'hot', 64))
    expect(res.body).toEqual({ status: 'refused', error: 'Write-back is off for Bayway' })
    expect(bay.send.setTemperature).not.toHaveBeenCalled()
  })

  it('reports an error and skips the mirror when FUB fails', async () => {
    bay.send.setTemperature.mockRejectedValueOnce(new Error('FUB PUT /people/6001 -> 500: down'))
    const res = await go(tempReq('c-t', 'hot', 65))
    expect(res.body.status).toBe('error')
    expect(res.body.results[0]).toMatchObject({ step: 'set_temperature', ok: false, error: 'FUB PUT /people/6001 -> 500: down' })
    expect(db.calls.filter((c) => c[0] === 'upsert' && c[1] === 'contacts')).toEqual([])
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'set_temperature', status: 'error' })
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

describe('crm-action run: contact_notes (read-only)', () => {
  const notesReq = (contactId) => ({ client_action_id: uuid(90), action: 'contact_notes', contact_id: contactId })

  it("pulls a Bayway lead's notes from FUB into the mirror, writing nothing to FUB", async () => {
    bay.read.notesFor = vi.fn(async () => [
      { id: 71, personId: 4821, body: 'Asked for W-2s', createdBy: 'Chandler Atkinson', created: '2026-10-18T15:00:00Z' },
      { id: 70, personId: 4821, body: 'Credit: 660-699 / loan type: DSCR', createdBy: 'LendingFlow', created: '2026-10-01T15:00:00Z' },
    ])
    const res = await go(notesReq('c-bay'))
    expect(res.body).toEqual({ status: 'ok', notes: 2 })
    expect(bay.read.notesFor).toHaveBeenCalledWith('4821')
    const rows = db.tables.activities.filter((a) => a.type === 'note')
    expect(rows.map((a) => [a.external_id, a.contact_id, a.business_id])).toEqual([
      ['note-71', 'c-bay', 'bay'],
      ['note-70', 'c-bay', 'bay'],
    ])
    expect(bay.sent).toEqual([])
    expect(db.tables.crm_actions || []).toEqual([])
  })

  it('reads MPG notes from Zoho the same way', async () => {
    mpg.read.notesFor = vi.fn(async () => [
      { id: 'N1', Note_Content: 'Sent statements', Parent_Id: { id: 'L555' }, $se_module: 'Leads', Created_Time: '2026-10-18T15:00:00+00:00' },
    ])
    const res = await go(notesReq('c-mpg'))
    expect(res.body).toEqual({ status: 'ok', notes: 1 })
    expect(db.tables.activities.find((a) => a.external_id === 'note-N1')).toMatchObject({ contact_id: 'c-mpg', business_id: 'mpg' })
  })

  it('says why when the CRM read fails', async () => {
    mpg.read.notesFor = vi.fn(async () => {
      throw new Error('Zoho GET Leads/L555/Notes -> NOT_SUPPORTED')
    })
    expect((await go(notesReq('c-mpg'))).body).toEqual({ status: 'error', error: 'Zoho GET Leads/L555/Notes -> NOT_SUPPORTED' })
  })

  it('needs a known contact', async () => {
    expect((await go(notesReq('nope'))).body).toEqual({ status: 'refused', error: 'Contact not found' })
  })
})

describe('crm-action run: contact_relationships (read-only)', () => {
  const relReq = (ids) => ({ client_action_id: uuid(91), action: 'contact_relationships', payload: { contact_ids: ids } })
  const jane = { id: 501, personId: 4821, type: "Buyer's Agent", firstName: 'Jane', lastName: 'Smith', phones: [{ value: '281-555-0100' }] }
  const spouse = { id: 502, personId: 4821, type: 'Spouse', firstName: 'Pat', lastName: 'Ramirez' }

  it("replaces a borrower's agents from FUB and stamps the sync, writing nothing to FUB", async () => {
    db.tables.contact_relationships = [{ contact_id: 'c-bay', external_id: '400', kind: 'seller_agent', name: 'Gone Agent' }]
    bay.read.relationshipsFor = vi.fn(async () => [jane, spouse])
    const res = await go(relReq(['c-bay']))
    expect(res.body).toEqual({ status: 'ok', synced: 1, skipped: 0, errors: [] })
    expect(bay.read.relationshipsFor).toHaveBeenCalledWith('4821')
    expect(db.tables.contact_relationships.map((r) => [r.contact_id, r.external_id, r.kind, r.name])).toEqual([
      ['c-bay', '501', 'buyer_agent', 'Jane Smith'],
    ])
    expect(db.tables.contact_relationship_syncs).toEqual([{ contact_id: 'c-bay', synced_at: expect.any(String) }])
    expect(bay.sent).toEqual([])
    expect(db.tables.crm_actions || []).toEqual([])
  })

  it('skips borrowers pulled in the last hour, MPG leads, and unknown ids', async () => {
    db.tables.contact_relationship_syncs = [{ contact_id: 'c-bay', synced_at: new Date(now.getTime() - 20 * 60_000).toISOString() }]
    bay.read.relationshipsFor = vi.fn(async () => [jane])
    const res = await go(relReq(['c-bay', 'c-mpg', 'nope']))
    expect(res.body).toEqual({ status: 'ok', synced: 0, skipped: 3, errors: [] })
    expect(bay.read.relationshipsFor).not.toHaveBeenCalled()
  })

  it('pulls again once the last pull is over an hour old', async () => {
    db.tables.contact_relationship_syncs = [{ contact_id: 'c-bay', synced_at: new Date(now.getTime() - 61 * 60_000).toISOString() }]
    bay.read.relationshipsFor = vi.fn(async () => [jane])
    expect((await go(relReq(['c-bay']))).body).toMatchObject({ status: 'ok', synced: 1 })
  })

  it('reports a failed borrower without stopping the others', async () => {
    bay.read.relationshipsFor = vi.fn(async (pid) => {
      if (pid === '4821') throw new Error('FUB GET /peopleRelationships -> 500')
      return [{ ...jane, id: 600, personId: 4822 }]
    })
    const res = await go(relReq(['c-bay', 'c-nophone']))
    expect(res.body).toEqual({ status: 'ok', synced: 1, skipped: 0, errors: [{ contact_id: 'c-bay', error: 'FUB GET /peopleRelationships -> 500' }] })
    expect(db.tables.contact_relationships.map((r) => r.contact_id)).toEqual(['c-nophone'])
  })

  it('says error when every pull failed', async () => {
    bay.read.relationshipsFor = vi.fn(async () => { throw new Error('FUB down') })
    expect((await go(relReq(['c-bay']))).body).toMatchObject({ status: 'error', error: 'FUB down' })
  })

  it('needs a list of ids, 25 at most', async () => {
    expect((await go(relReq([]))).body).toEqual({ status: 'refused', error: 'contact_ids is required' })
    const many = Array.from({ length: 26 }, (_, i) => `c-${i}`)
    expect((await go(relReq(many))).body).toEqual({ status: 'refused', error: 'At most 25 contacts at a time' })
  })
})

describe('crm-action run: assistant role', () => {
  const ASSISTANT = '00000000-0000-4000-8000-0000000000a1'
  const asAssistant = (req, extra = {}) => go(req, { userId: ASSISTANT, role: 'assistant', ...extra })
  const noteReq = (contactId = 'c-bay', n = 81) => ({ client_action_id: uuid(n), action: 'add_note', contact_id: contactId, payload: { body: 'Sent the doc list' } })

  it('lets the assistant add a note on a Bayway contact, recorded under her id', async () => {
    const res = await asAssistant(noteReq())
    expect(res.http).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'add_note', status: 'ok', user_id: ASSISTANT })
  })
  it('lets the assistant complete a Bayway task and create a follow-up', async () => {
    expect((await asAssistant({ client_action_id: uuid(82), action: 'complete_task', task_id: 't-open' })).body.status).toBe('ok')
    expect((await asAssistant({ client_action_id: uuid(83), action: 'create_task', contact_id: 'c-bay', payload: { due_date: '2026-10-20', title: 'Follow up: Jo' } })).body.status).toBe('ok')
  })
  it('refuses Log call from the assistant and records the refusal', async () => {
    const res = await asAssistant(logCallReq())
    expect(res.http).toBe(200)
    expect(res.body).toMatchObject({ status: 'refused', error: 'The assistant login cannot do that' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'log_call', status: 'refused', user_id: ASSISTANT })
    expect(bay.send.logCall).not.toHaveBeenCalled()
  })
  it('refuses set_stage, set_temperature and push_task from the assistant', async () => {
    expect((await asAssistant({ client_action_id: uuid(84), action: 'set_stage', contact_id: 'c-bay', payload: { target: 'working' } })).body.status).toBe('refused')
    expect((await asAssistant({ client_action_id: uuid(85), action: 'set_temperature', contact_id: 'c-bay', payload: { temperature: 'hot' } })).body.status).toBe('refused')
    expect((await asAssistant({ client_action_id: uuid(86), action: 'push_task', task_id: 't-open', payload: { due_date: '2026-10-21' } })).body.status).toBe('refused')
  })
  it('refuses an MPG contact for the assistant', async () => {
    const res = await asAssistant(noteReq('c-mpg', 87))
    expect(res.body).toMatchObject({ status: 'refused', error: 'The assistant login is Bayway only' })
  })
  it('refuses an MPG contact_notes read for the assistant', async () => {
    const res = await asAssistant({ client_action_id: uuid(88), action: 'contact_notes', contact_id: 'c-mpg' })
    expect(res.body).toMatchObject({ status: 'refused', error: 'The assistant login is Bayway only' })
  })
  it('403s whoami and smart_lists for the assistant', async () => {
    expect((await asAssistant({ client_action_id: uuid(89), action: 'whoami' })).http).toBe(403)
    expect((await asAssistant({ client_action_id: uuid(90), action: 'smart_lists' })).http).toBe(403)
  })
  it('403s a signed-in user with no role and writes nothing', async () => {
    const res = await go(noteReq(), { userId: ASSISTANT, role: null })
    expect(res.http).toBe(403)
    expect(db.calls).toEqual([])
  })
})

describe('crm-action run: promote_prospect (MPG walk-in to a Zoho Open lead)', () => {
  const ASSISTANT = '00000000-0000-4000-8000-0000000000a1'
  const OTHER = '00000000-0000-4000-8000-0000000000b2'
  const promoteReq = (payload = {}, n = 100, ids = {}) => ({
    client_action_id: uuid(n), action: 'promote_prospect', business_id: 'mpg',
    prospect_id: 'p-1', touch_id: 'touch-1', ...ids,
    payload: { note: 'Walk-in · Warm — owner Ana', ...payload },
  })
  const prospect = (over) => ({
    id: 'p-1', user_id: USER, business_name: 'Ruiz Deli', contact_name: 'Ana Ruiz', contact_role: 'Owner',
    phone: '(713) 555-0199', phone_key: '7135550199', email: 'ana@ruizdeli.com', address: '1 Main St, Houston',
    temperature: 'hot', status: 'working', zoho_lead_id: null, zoho_wanted: true, promoting_at: null, ...over,
  })
  const touch = (over) => ({ id: 'touch-1', user_id: USER, prospect_id: 'p-1', temperature: 'warm', contact_id: null, crm_action_id: null, ...over })
  const candidate = (id, status) => ({ id, company: 'Ruiz Deli', name: 'Ana Ruiz', phone: '7135550199', status })

  // A tiny Zoho Leads module: what was created or exists, by id.
  let leads
  const zohoLeadRec = (id, Lead_Status) => ({ id, First_Name: 'Ana', Last_Name: 'Ruiz', Company: 'Ruiz Deli', Phone: '(713) 555-0199', Lead_Status })
  const prospectRow = (id = 'p-1') => db.tables.mpg_prospects.find((p) => p.id === id)
  const touchRow = (id = 'touch-1') => db.tables.mpg_touches.find((t) => t.id === id)
  const zohoWrites = () => ['createLead', 'setLeadOpen', 'addNote', 'createTask'].flatMap((k) => mpg.send[k].mock.calls)
  // Every db write except taking and releasing the promotion lease.
  const isLease = (c) => c[0] === 'update' && c[1] === 'mpg_prospects' && Object.keys(c[2]).join() === 'promoting_at'
  const writesBesidesLease = () => db.calls.filter((c) => !isLease(c))
  const leaseCalls = () => db.calls.filter(isLease).map((c) => c[2].promoting_at)

  beforeEach(() => {
    db.tables.settings.push({ key: 'create_lead_enabled', value: { bay: false, mpg: true } })
    db.tables.mpg_prospects = [
      prospect(),
      prospect({ id: 'p-other', user_id: OTHER }),
      prospect({ id: 'p-done', status: 'promoted', zoho_lead_id: 'Z-OLD' }),
      prospect({ id: 'p-asst', user_id: ASSISTANT }),
      prospect({ id: 'p-2' }),
    ]
    db.tables.mpg_touches = [
      touch(),
      touch({ id: 'touch-other', user_id: OTHER, prospect_id: 'p-other' }),
      touch({ id: 'touch-done', prospect_id: 'p-done' }),
      touch({ id: 'touch-asst', user_id: ASSISTANT, prospect_id: 'p-asst' }),
      touch({ id: 'touch-2', prospect_id: 'p-2' }),
    ]
    db.tables.lead_ratings = []
    leads = new Map()
    mpg.send.findLeads = vi.fn(async () => [])
    mpg.send.createLead = vi.fn(async () => {
      leads.set('Z-NEW-1', zohoLeadRec('Z-NEW-1', 'Open'))
      return { id: 'Z-NEW-1' }
    })
    mpg.send.setLeadOpen = vi.fn(async ({ externalId }) => {
      leads.get(String(externalId)).Lead_Status = 'Open'
      return { id: String(externalId) }
    })
    mpg.read.lead = vi.fn(async (id) => {
      const rec = leads.get(String(id))
      if (!rec) throw new Error(`Zoho GET Leads/${id} returned no record`)
      return { ...rec }
    })
    mpg.read.note = async (id, ctx) => ({ id, Note_Content: ctx.body, Parent_Id: { id: ctx.externalId }, $se_module: 'Leads', Created_Time: '2026-11-06T15:00:00+00:00' })
    mpg.read.task = async (id) => ({
      id, Subject: 'Bring statement', Due_Date: '2026-11-10', Status: 'Not Started',
      What_Id: { id: mpg.send.createTask.mock.calls.at(-1)[0].externalId }, $se_module: 'Leads',
    })
    mpg.map.contact = (rec) => zohoMapContact(rec, 'Leads')
  })

  it('creates an Open lead when Zoho has no match, then the note, the task and the bookkeeping', async () => {
    const res = await go(promoteReq({ follow_up: { due_date: '2026-11-10', title: 'Bring statement' } }))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.findLeads).toHaveBeenCalledWith({ phoneKey: '7135550199', company: 'Ruiz Deli' })
    expect(mpg.send.createLead).toHaveBeenCalledWith({
      business: 'Ruiz Deli', contactName: 'Ana Ruiz', role: 'Owner', phone: '(713) 555-0199',
      email: 'ana@ruizdeli.com', address: '1 Main St, Houston',
    })
    expect(mpg.send.setLeadOpen).not.toHaveBeenCalled()

    // Mirrored through the zoho-sync mapper.
    const contact = db.tables.contacts.find((c) => c.external_id === 'Z-NEW-1')
    expect(contact).toMatchObject({ business_id: 'mpg', source_crm: 'zoho', name: 'Ana Ruiz', company: 'Ruiz Deli', person_stage: 'Open' })
    expect(res.body.results.map((r) => [r.step, r.ok])).toEqual([['promote', true], ['add_note', true], ['create_task', true]])
    expect(res.body.results[0]).toMatchObject({ crm_id: 'Z-NEW-1', lead_id: 'Z-NEW-1', linked: false, contact_id: contact.id })
    expect(res.body.results[0].mirror_error).toBeUndefined()

    // Note and task hang off the new lead.
    expect(mpg.send.addNote).toHaveBeenCalledWith({ externalId: 'Z-NEW-1', subject: 'Walk-in', body: 'Walk-in · Warm — owner Ana' })
    expect(mpg.send.createTask).toHaveBeenCalledWith({ externalId: 'Z-NEW-1', title: 'Bring statement', type: 'Follow Up', dueDate: '2026-11-10' })
    expect(db.tables.activities.find((a) => a.external_id === 'note-Z-NOTE-1')).toMatchObject({ contact_id: contact.id })
    expect(db.tables.tasks.find((t) => t.external_id === 'Z-TASK-1')).toMatchObject({ contact_id: contact.id })

    const action = db.tables.crm_actions.at(-1)
    expect(action).toMatchObject({ action: 'promote_prospect', business_id: 'mpg', user_id: USER, status: 'ok', contact_id: contact.id })
    expect(prospectRow()).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-NEW-1', zoho_wanted: false, promoted_at: now.toISOString() })
    expect(touchRow()).toMatchObject({ contact_id: contact.id, crm_action_id: action.id })
    expect(db.tables.lead_ratings).toEqual([
      { contact_id: contact.id, business_id: 'mpg', temperature: 'warm', rated_at: now.toISOString(), rated_by: USER },
    ])
    expect(db.calls.find((c) => c[0] === 'upsert' && c[1] === 'lead_ratings')[3]).toEqual({ onConflict: 'contact_id' })
    // The other prospects are untouched, and the lease is given back.
    expect(prospectRow('p-2')).toMatchObject({ status: 'working', zoho_wanted: true })
    expect(prospectRow().promoting_at).toBeNull()
    expect(leaseCalls()).toEqual([now.toISOString(), null])
  })

  it("rates with the prospect's temperature when the touch has none", async () => {
    touchRow().temperature = null
    await go(promoteReq({ note: undefined }, 101))
    expect(db.tables.lead_ratings[0]).toMatchObject({ temperature: 'hot', rated_by: USER })
  })

  it('writes no rating when neither the touch nor the prospect has a temperature', async () => {
    touchRow().temperature = null
    prospectRow().temperature = null
    expect((await go(promoteReq({}, 102))).body.status).toBe('ok')
    expect(db.tables.lead_ratings).toEqual([])
  })

  it('links the one matching "Initial lead" and sets it to Open', async () => {
    leads.set('Z-INIT', zohoLeadRec('Z-INIT', 'Initial lead'))
    mpg.send.findLeads = vi.fn(async () => [candidate('Z-INIT', 'Initial lead')])
    const res = await go(promoteReq({}, 103))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.setLeadOpen).toHaveBeenCalledWith({ externalId: 'Z-INIT' })
    expect(mpg.send.createLead).not.toHaveBeenCalled()
    expect(res.body.results[0]).toMatchObject({ step: 'promote', ok: true, lead_id: 'Z-INIT', linked: true })
    expect(db.tables.contacts.find((c) => c.external_id === 'Z-INIT')).toMatchObject({ person_stage: 'Open' })
    expect(mpg.send.addNote).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'Z-INIT' }))
    expect(prospectRow()).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-INIT' })
  })

  it('links the one matching worked lead without changing its status', async () => {
    leads.set('Z-PEND', zohoLeadRec('Z-PEND', 'Pending'))
    mpg.send.findLeads = vi.fn(async () => [candidate('Z-PEND', 'Pending')])
    const res = await go(promoteReq({}, 104))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.setLeadOpen).not.toHaveBeenCalled()
    expect(mpg.send.createLead).not.toHaveBeenCalled()
    expect(res.body.results[0]).toMatchObject({ lead_id: 'Z-PEND', linked: true })
    expect(db.tables.contacts.find((c) => c.external_id === 'Z-PEND')).toMatchObject({ person_stage: 'Pending' })
  })

  it('returns the candidates when more than one lead matches, and writes nothing', async () => {
    const candidates = [candidate('Z-A', 'Pending'), candidate('Z-B', 'Initial lead')]
    mpg.send.findLeads = vi.fn(async () => candidates)
    const res = await go(promoteReq({}, 105))
    expect(res.body).toEqual({ status: 'choose', candidates })
    expect(db.tables.crm_actions).toEqual([])
    expect(writesBesidesLease()).toEqual([])
    expect(zohoWrites()).toEqual([])
    // The lease was taken for the search and given back.
    expect(leaseCalls()).toEqual([now.toISOString(), null])
    expect(prospectRow()).toMatchObject({ status: 'working', zoho_wanted: true, promoting_at: null })
  })

  it('reports a failed search without claiming anything', async () => {
    mpg.send.findLeads = vi.fn(async () => { throw new Error('Zoho POST coql -> 500: down') })
    const res = await go(promoteReq({}, 106))
    expect(res.body).toEqual({ status: 'error', error: 'Zoho POST coql -> 500: down' })
    expect(db.tables.crm_actions).toEqual([])
    expect(writesBesidesLease()).toEqual([])
    expect(zohoWrites()).toEqual([])
    expect(prospectRow().promoting_at).toBeNull()
  })

  it('links the chosen lead without searching again', async () => {
    leads.set('Z-B', zohoLeadRec('Z-B', 'Initial lead'))
    const res = await go(promoteReq({ link_lead_id: 'Z-B' }, 107))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(mpg.read.lead).toHaveBeenCalledWith('Z-B')
    expect(mpg.send.setLeadOpen).toHaveBeenCalledWith({ externalId: 'Z-B' })
    expect(mpg.send.createLead).not.toHaveBeenCalled()
    expect(res.body.results[0]).toMatchObject({ lead_id: 'Z-B', linked: true })
  })

  it('refuses a chosen lead id that is not a Zoho id', async () => {
    const res = await go(promoteReq({ link_lead_id: '../Deals/1' }, 130))
    expect(res.body).toEqual({ status: 'refused', error: 'Unknown Zoho lead id' })
    expect(mpg.read.lead).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
  })

  it('creates a new lead without searching when asked to', async () => {
    const res = await go(promoteReq({ create_new: true }, 108))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(mpg.send.createLead).toHaveBeenCalledTimes(1)
    expect(res.body.results[0]).toMatchObject({ lead_id: 'Z-NEW-1', linked: false })
  })

  it("links the prospect's own Zoho lead without searching", async () => {
    prospectRow().zoho_lead_id = 'Z-MINE'
    leads.set('Z-MINE', zohoLeadRec('Z-MINE', 'Open'))
    const res = await go(promoteReq({}, 109))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(mpg.send.createLead).not.toHaveBeenCalled()
    expect(res.body.results[0]).toMatchObject({ lead_id: 'Z-MINE', linked: true })
  })

  it("refuses another user's prospect or touch without a row or a Zoho call", async () => {
    const cases = [
      { prospect_id: 'p-other', touch_id: 'touch-other' },
      { prospect_id: 'p-other', touch_id: 'touch-1' },
      { prospect_id: 'p-1', touch_id: 'touch-other' },
      { prospect_id: 'p-1', touch_id: 'touch-2' }, // my touch, but on another prospect
      { prospect_id: 'nope', touch_id: 'touch-1' },
      { prospect_id: 'p-1', touch_id: 'nope' },
    ]
    for (const [i, ids] of cases.entries()) {
      expect((await go(promoteReq({}, 110 + i, ids))).body).toEqual({ status: 'refused', error: 'Prospect not found' })
    }
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
    expect(db.calls).toEqual([])
  })

  it('needs a prospect and a touch', async () => {
    expect((await go(promoteReq({}, 120, { prospect_id: undefined }))).body).toEqual({ status: 'refused', error: 'prospect_id and touch_id are required' })
    expect((await go(promoteReq({}, 121, { touch_id: undefined }))).body).toEqual({ status: 'refused', error: 'prospect_id and touch_id are required' })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
  })

  it('refuses a prospect that is already in Zoho', async () => {
    const res = await go(promoteReq({}, 122, { prospect_id: 'p-done', touch_id: 'touch-done' }))
    expect(res.body).toEqual({ status: 'refused', error: 'Already in Zoho' })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
  })

  it('refuses and records when new-lead create is off for MPG, before searching', async () => {
    db.tables.settings.find((s) => s.key === 'create_lead_enabled').value = { bay: true, mpg: false }
    const res = await go(promoteReq({}, 123))
    expect(res.body).toEqual({ status: 'refused', error: 'New lead is off for MPG' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'promote_prospect', status: 'refused', user_id: USER })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
    expect(prospectRow()).toMatchObject({ status: 'working' })
  })

  it('refuses and records when MPG write-back is off, before searching', async () => {
    db.tables.settings[0].value = { bay: true, mpg: false }
    const res = await go(promoteReq({}, 124))
    expect(res.body).toEqual({ status: 'refused', error: 'Write-back is off for MPG' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ status: 'refused' })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
  })

  it('refuses the assistant before searching', async () => {
    const own = await go(promoteReq({}, 125, { prospect_id: 'p-asst', touch_id: 'touch-asst' }), { userId: ASSISTANT, role: 'assistant' })
    expect(own.body).toEqual({ status: 'refused', error: 'The assistant login cannot do that' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'promote_prospect', status: 'refused', user_id: ASSISTANT })
    const chandlers = await go(promoteReq({}, 126), { userId: ASSISTANT, role: 'assistant' })
    expect(chandlers.body).toEqual({ status: 'refused', error: 'Prospect not found' })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
  })

  it('stops when the create fails and leaves the prospect not promoted', async () => {
    mpg.send.createLead = vi.fn(async () => { throw new Error('Zoho POST Leads -> 400: MANDATORY_NOT_FOUND') })
    const res = await go(promoteReq({ follow_up: { due_date: '2026-11-10' } }, 127))
    expect(res.body).toEqual({ status: 'error', results: [{ step: 'promote', ok: false, error: 'Zoho POST Leads -> 400: MANDATORY_NOT_FOUND' }] })
    expect(mpg.send.addNote).not.toHaveBeenCalled()
    expect(mpg.send.createTask).not.toHaveBeenCalled()
    expect(prospectRow()).toMatchObject({ status: 'working', zoho_lead_id: null, zoho_wanted: true, promoting_at: null })
    expect(touchRow()).toMatchObject({ contact_id: null, crm_action_id: null })
    expect(db.tables.lead_ratings).toEqual([])
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ status: 'error' })
  })

  it('is partial when the note fails after the create, and the prospect is still promoted', async () => {
    mpg.send.addNote.mockRejectedValueOnce(new Error('Zoho POST Leads/Z-NEW-1/Notes -> 500'))
    const res = await go(promoteReq({}, 128))
    expect(res.body.status).toBe('partial')
    expect(res.body.results.map((r) => [r.step, r.ok])).toEqual([['promote', true], ['add_note', false]])
    expect(prospectRow()).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-NEW-1', zoho_wanted: false })
    expect(touchRow().crm_action_id).toBe(db.tables.crm_actions.at(-1).id)
  })

  it('reports a failed bookkeeping write on the promote result without failing the run', async () => {
    db.failUpsertOn('lead_ratings')
    const res = await go(promoteReq({}, 129))
    expect(res.body.status).toBe('ok')
    expect(res.body.results[0].mirror_error).toMatch(/lead_ratings/)
    expect(prospectRow()).toMatchObject({ status: 'promoted' })
    expect(db.tables.crm_actions.at(-1).results[0].mirror_error).toMatch(/lead_ratings/)
  })

  // --- the lease: one promotion of a prospect at a time ---------------------

  it('answers busy to a second promotion while the first holds the lease', async () => {
    let release
    mpg.send.createLead = vi.fn(() => new Promise((r) => {
      release = () => {
        leads.set('Z-NEW-1', zohoLeadRec('Z-NEW-1', 'Open'))
        r({ id: 'Z-NEW-1' })
      }
    }))
    const first = go(promoteReq({}, 140))
    await vi.waitFor(() => expect(mpg.send.createLead).toHaveBeenCalledTimes(1))
    expect(prospectRow().promoting_at).toBe(now.toISOString())

    const second = await go(promoteReq({ create_new: true }, 141))
    expect(second.body).toEqual({ status: 'busy', error: 'Already adding this business to Zoho' })
    expect(db.tables.crm_actions.map((r) => r.client_action_id)).toEqual([uuid(140)])

    release()
    expect((await first).body.status).toBe('ok')
    expect(mpg.send.createLead).toHaveBeenCalledTimes(1)
    expect(prospectRow()).toMatchObject({ status: 'promoted', promoting_at: null })
  })

  it('answers busy, with no Zoho call and no row, while a fresh lease is held', async () => {
    prospectRow().promoting_at = new Date(now.getTime() - 30_000).toISOString()
    const res = await go(promoteReq({}, 142))
    expect(res.body).toEqual({ status: 'busy', error: 'Already adding this business to Zoho' })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
    expect(db.tables.crm_actions).toEqual([])
    // Not ours to give back.
    expect(prospectRow().promoting_at).toBe(new Date(now.getTime() - 30_000).toISOString())
  })

  it('takes over a lease older than two minutes', async () => {
    prospectRow().promoting_at = new Date(now.getTime() - 3 * 60_000).toISOString()
    expect((await go(promoteReq({}, 143))).body.status).toBe('ok')
    expect(prospectRow()).toMatchObject({ status: 'promoted', promoting_at: null })
  })

  it('gives the lease back when the run refuses after the claim', async () => {
    // The flag flips off between the pre-claim check and the claim.
    const settings = db.tables.settings.find((s) => s.key === 'create_lead_enabled')
    mpg.send.findLeads = vi.fn(async () => {
      settings.value = { mpg: false }
      return []
    })
    const res = await go(promoteReq({}, 144))
    expect(res.body).toEqual({ status: 'refused', error: 'New lead is off for MPG' })
    expect(prospectRow().promoting_at).toBeNull()
  })

  // --- the same submit twice ------------------------------------------------

  it('replays a finished promotion to the same submit instead of refusing it', async () => {
    const first = await go(promoteReq({}, 150))
    expect(first.body.status).toBe('ok')
    const second = await go(promoteReq({}, 150))
    expect(second.body).toEqual({ ...first.body, replay: true })
    expect(mpg.send.createLead).toHaveBeenCalledTimes(1)
    expect(db.tables.crm_actions).toHaveLength(1)
  })

  // --- lead ids -------------------------------------------------------------

  it("refuses a stored zoho_lead_id that isn't a Zoho id before any Zoho call", async () => {
    prospectRow().zoho_lead_id = 'Leads/../Deals'
    const res = await go(promoteReq({}, 160))
    expect(res.body).toEqual({ status: 'refused', error: 'Unknown Zoho lead id' })
    expect(mpg.send.findLeads).not.toHaveBeenCalled()
    expect(mpg.read.lead).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
  })

  it("fails the promote on a search match whose id isn't a Zoho id", async () => {
    mpg.send.findLeads = vi.fn(async () => [candidate('../Deals/1', 'Pending')])
    const res = await go(promoteReq({}, 161))
    expect(res.body).toEqual({ status: 'error', results: [{ step: 'promote', ok: false, error: 'Unknown Zoho lead id' }] })
    expect(mpg.read.lead).not.toHaveBeenCalled()
    expect(zohoWrites()).toEqual([])
    expect(prospectRow()).toMatchObject({ status: 'working', promoting_at: null })
  })

  it('creates when asked to, even with a stored zoho_lead_id', async () => {
    prospectRow().zoho_lead_id = 'Z-STALE'
    const res = await go(promoteReq({ create_new: true }, 162))
    expect(res.body.status).toBe('ok')
    expect(mpg.read.lead).not.toHaveBeenCalledWith('Z-STALE')
    expect(mpg.send.createLead).toHaveBeenCalledTimes(1)
    expect(res.body.results[0]).toMatchObject({ lead_id: 'Z-NEW-1', linked: false })
    expect(prospectRow()).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-NEW-1' })
  })

  // --- one "Initial lead" rule (isExcludedLead) -----------------------------

  it('opens a linked lead whose status is "Initial lead" in any case or spacing', async () => {
    leads.set('Z-I', zohoLeadRec('Z-I', 'INITIAL LEAD '))
    expect((await go(promoteReq({ link_lead_id: 'Z-I' }, 170))).body.status).toBe('ok')
    expect(mpg.send.setLeadOpen).toHaveBeenCalledWith({ externalId: 'Z-I' })
  })

  it('leaves "Initial lead follow up" as it is', async () => {
    leads.set('Z-F', zohoLeadRec('Z-F', 'Initial lead follow up'))
    expect((await go(promoteReq({ link_lead_id: 'Z-F' }, 171))).body.status).toBe('ok')
    expect(mpg.send.setLeadOpen).not.toHaveBeenCalled()
  })

  // --- failures around the promote step -------------------------------------

  it('fails the promote when the chosen lead cannot be read, and marks nothing', async () => {
    const res = await go(promoteReq({ link_lead_id: 'Z-GONE' }, 180))
    expect(res.body).toEqual({ status: 'error', results: [{ step: 'promote', ok: false, error: 'Zoho GET Leads/Z-GONE returned no record' }] })
    expect(zohoWrites()).toEqual([])
    expect(prospectRow()).toMatchObject({ status: 'working', zoho_lead_id: null, zoho_wanted: true, promoting_at: null })
    expect(touchRow()).toMatchObject({ contact_id: null, crm_action_id: null })
  })

  it('fails the promote when opening the lead fails', async () => {
    leads.set('Z-INIT', zohoLeadRec('Z-INIT', 'Initial lead'))
    mpg.send.setLeadOpen = vi.fn(async () => { throw new Error('Zoho PUT Leads/Z-INIT -> 500') })
    const res = await go(promoteReq({ link_lead_id: 'Z-INIT' }, 181))
    expect(res.body.status).toBe('error')
    expect(res.body.results).toEqual([{ step: 'promote', ok: false, error: 'Zoho PUT Leads/Z-INIT -> 500' }])
    expect(mpg.send.addNote).not.toHaveBeenCalled()
    expect(prospectRow()).toMatchObject({ status: 'working', promoting_at: null })
  })

  it('still marks the prospect promoted when the lead read-back fails after a create', async () => {
    mpg.read.lead = vi.fn(async () => { throw new Error('Zoho GET Leads/Z-NEW-1 -> 500') })
    const res = await go(promoteReq({}, 182))
expect(res.body.status).toBe('ok')
    expect(res.body.results[0]).toMatchObject({ step: 'promote', ok: true, lead_id: 'Z-NEW-1', mirror_error: 'Zoho GET Leads/Z-NEW-1 -> 500' })
    expect(res.body.results[1]).toMatchObject({ step: 'add_note', ok: true })
    expect(prospectRow()).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-NEW-1', zoho_wanted: false, promoting_at: null })
    expect(touchRow()).toMatchObject({ contact_id: null, crm_action_id: db.tables.crm_actions.at(-1).id })
  })

  it('still sends the note and task to the new lead when the mirror read-back fails', async () => {
    mpg.read.lead = vi.fn(async () => { throw new Error('Zoho GET Leads/Z-NEW-1 -> 500') })
    mpg.read.task = async () => { throw new Error('Zoho GET Tasks -> 500') }
    const res = await go(promoteReq({ follow_up: { due_date: '2026-11-10', title: 'Bring statement' } }, 190))
    expect(mpg.send.addNote).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'Z-NEW-1' }))
    expect(mpg.send.createTask).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'Z-NEW-1', dueDate: '2026-11-10' }))
    expect(res.body.results.map((r) => [r.step, r.ok])).toEqual([['promote', true], ['add_note', true], ['create_task', true]])
    expect(res.body.results[1].mirror_error).toBeTruthy()
    expect(res.body.results[2].mirror_error).toBeTruthy()
    expect(prospectRow()).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-NEW-1' })
  })

  it('re-opens a created lead that a Zoho workflow set to Initial lead, before mirroring', async () => {
    mpg.send.createLead = vi.fn(async () => {
      leads.set('Z-NEW-1', zohoLeadRec('Z-NEW-1', 'Initial lead'))
      return { id: 'Z-NEW-1' }
    })
    const res = await go(promoteReq({}, 191))
    expect(res.body.status).toBe('ok')
    expect(mpg.send.setLeadOpen).toHaveBeenCalledWith({ externalId: 'Z-NEW-1' })
    expect(db.tables.contacts.find((c) => c.external_id === 'Z-NEW-1')).toMatchObject({ person_stage: 'Open' })
  })

  it('replays a failed result with its error', async () => {
    mpg.send.createLead = vi.fn(async () => { throw new Error('Zoho POST Leads -> 400: bad') })
    await go(promoteReq({}, 192))
    const again = await go(promoteReq({}, 192))
    expect(again.body).toMatchObject({ replay: true, status: 'error', error: 'Zoho POST Leads -> 400: bad' })
  })

  it('quotes the lease timestamp in the or() filter', async () => {
    await go(promoteReq({}, 193))
    expect(db.orExprs[0]).toMatch(/promoting_at.lt."[^"]+"/)
  })

  it('marks the prospect promoted before the note and follow-up are sent', async () => {
    let atNote
    mpg.send.addNote = vi.fn(async () => {
      atNote = { ...prospectRow() }
      return { id: 'Z-NOTE-1' }
    })
    await go(promoteReq({}, 183))
    expect(atNote).toMatchObject({ status: 'promoted', zoho_lead_id: 'Z-NEW-1', zoho_wanted: false, promoted_at: now.toISOString() })
  })

  it('reports a failed prospect update on the promote result and stays ok', async () => {
    db.failUpdateOn('mpg_prospects', (patch) => 'status' in patch)
    const res = await go(promoteReq({}, 184))
    expect(res.body.status).toBe('ok')
    expect(res.body.results[0].mirror_error).toMatch(/mpg_prospects update: update down/)
    expect(prospectRow()).toMatchObject({ status: 'working', promoting_at: null })
    expect(touchRow().crm_action_id).toBe(db.tables.crm_actions.at(-1).id)
  })
})
