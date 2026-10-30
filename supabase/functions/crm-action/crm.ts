// Real CRM adapters for crm-action: { send, read, map } per book. Thin on
// purpose: request bodies come from the pure builders in _shared/*-write.ts,
// and map.* are the scheduled syncs' own mappers (see run.ts for why).
//
// VERIFY on the first live run (see docs/phase-writeback-setup.md): FUB's
// single-record read paths (/calls/{id}, /notes/{id}, /tasks/{id}, /me) and
// whether PUT /tasks/{id} accepts dueDate (FUB_PUSH_MODE).

import { fubGet, fubSend, mapContact } from '../_shared/fub.ts'
import { retagForTarget, targetForStage } from '../_shared/bay-stages.ts'
import { relationshipsOf } from '../_shared/fub-relationships.ts'
import { buildFubCall, buildFubNote, buildFubTask, buildFubTaskUpdate, buildFubLeadEvent, FUB_TASK_TYPES } from '../_shared/fub-write.ts'
import { mapActivity as fubMapActivity } from '../_shared/fub-activity.ts'
import { mapTask as fubMapTask } from '../_shared/fub-tasks.ts'
import { getAccessToken, zohoGet, zohoSend, mapContact as zohoMapContact } from '../_shared/zoho.ts'
import {
  buildZohoCall, buildZohoNote, buildZohoTask, buildZohoTaskUpdate, buildZohoLead, zohoCreatedId,
} from '../_shared/zoho-write.ts'
import { mapActivity as zohoMapActivity } from '../_shared/zoho-activity.ts'
import { mapTask as zohoMapTask } from '../_shared/zoho-tasks.ts'

function fubId(json) {
  const id = json?.id
  if (id == null) throw new Error(`FUB create returned no id: ${JSON.stringify(json).slice(0, 200)}`)
  return id
}

// env: (key) => string | undefined
export function fubAdapter(env) {
  const assignedUserId = env('FUB_USER_ID')
  // 'put_due_date' (default) or 'complete_and_recreate', set after the live
  // check of whether FUB's PUT /tasks/{id} honors dueDate.
  const pushMode = env('FUB_PUSH_MODE') || 'put_due_date'

  const createTask = async ({ externalId, title, type, dueDate }) => ({
    id: fubId(await fubSend('POST', '/tasks', buildFubTask({ personId: externalId, assignedUserId, title, type, dueDate }))),
  })

  return {
    send: {
      logCall: async ({ externalId, phone, outcome, note, durationMin }) => ({
        id: fubId(await fubSend('POST', '/calls', buildFubCall({ personId: externalId, phone, outcome, note, durationMin }))),
      }),
      addNote: async ({ externalId, subject, body }) => ({
        id: fubId(await fubSend('POST', '/notes', buildFubNote({ personId: externalId, subject, body }))),
      }),
      createTask,
      completeTask: async ({ externalId }) => {
        await fubSend('PUT', `/tasks/${externalId}`, buildFubTaskUpdate({ complete: true }))
        return { id: externalId }
      },
      // New lead (dashboard "New lead…"). Sent as an event so FUB dedupes it
      // and runs its lead flow. FUB can't assign in the same call, so a
      // brand-new lead routed to someone else is reassigned to Chandler; a
      // person that already existed is never taken from another agent.
      createContact: async ({ firstName, lastName, phone, email }) => {
        const started = Date.now()
        const person = await fubSend('POST', '/events', buildFubLeadEvent({ firstName, lastName, phone, email }))
        if (person?.id == null) throw new Error('FollowUpBoss ignored the lead (the lead flow for this source may be archived)')
        const createdAt = Date.parse(person.created)
        const existing = Number.isFinite(createdAt) && createdAt < started - 5 * 60_000
        const mine = String(person.assignedUserId ?? '') === String(assignedUserId)
        if (!mine) {
          if (existing) throw new Error(`Already in FollowUpBoss as ${person.name || 'a lead'}, assigned to another agent`)
          await fubSend('PUT', `/people/${person.id}`, { assignedUserId: Number(assignedUserId) })
        }
        return { id: person.id, existing }
      },
      // Move stage = swap workflow tags. PUT /people replaces the whole tag
      // list, so read the current tags and send the full new list.
      setStage: async ({ externalId, target }) => {
        const person = await fubGet(`/people/${externalId}`)
        const tags = retagForTarget(person.tags || [], target)
        await fubSend('PUT', `/people/${externalId}`, { tags })
        // previous: the column it left, so an Undo can put it back.
        return { id: externalId, tags, previous: targetForStage(person.tags || [], person.stage) }
      },
      pushTask: async ({ externalId, dueDate, contactExternalId, title, type }) => {
        if (pushMode === 'complete_and_recreate') {
          if (!contactExternalId) throw new Error('Task has no contact to reschedule onto')
          await fubSend('PUT', `/tasks/${externalId}`, buildFubTaskUpdate({ complete: true }))
          const created = await createTask({
            externalId: contactExternalId,
            title,
            type: FUB_TASK_TYPES.includes(type) ? type : 'Follow Up',
            dueDate,
          })
          return { id: created.id, also: [externalId], rescheduled: true }
        }
        await fubSend('PUT', `/tasks/${externalId}`, buildFubTaskUpdate({ dueDate }))
        return { id: externalId }
      },
    },
    read: {
      call: (id) => fubGet(`/calls/${id}`),
      note: (id) => fubGet(`/notes/${id}`),
      // Every note on one person, newest first (contact card).
      notesFor: async (personId) => (await fubGet('/notes', { personId, sort: '-created', limit: 100 })).notes || [],
      task: (id) => fubGet(`/tasks/${id}`),
      person: (id) => fubGet(`/people/${id}`),
      // The borrower's FUB Relationships (buyer's / seller's agent; dialer phase 3).
      relationshipsFor: async (personId) => relationshipsOf(await fubGet('/peopleRelationships', { personId, limit: 100 })),
    },
    map: { activity: fubMapActivity, task: fubMapTask, contact: mapContact },
    whoami: async () => {
      const me = await fubGet('/me')
      return { id: me.id, name: me.name, email: me.email, role: me.role }
    },
    smartLists: async () => summarizeSmartLists(fubGet, env('FUB_USER_ID')),
  }
}

const listOf = (json, keys) => {
  for (const k of keys) {
    if (Array.isArray(json?.[k])) return json[k]
    if (Array.isArray(json?._embedded?.[k])) return json._embedded[k]
  }
  return []
}

function tally(values, top = 12) {
  const m = new Map()
  for (const v of values) m.set(v, (m.get(v) || 0) + 1)
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top))
}

// VERIFY: FUB's /smartLists shape and whether /people honors smartListId.
// all_people_total is the unfiltered count: a list reporting the same total
// means the filter was ignored. Samples up to 100 people per list.
export async function summarizeSmartLists(get, myUserId) {
  // Custom lists built in FUB 2.0 only come back with fub2=true; merge both.
  const json = await get('/smartLists', { limit: 100 })
  const json2 = await get('/smartLists', { limit: 100, fub2: true }).catch(() => ({}))
  const byId = new Map()
  for (const l of [...listOf(json, ['smartlists', 'smartLists']), ...listOf(json2, ['smartlists', 'smartLists'])]) {
    byId.set(l.id, l)
  }
  const lists = [...byId.values()]
  const all = await get('/people', { limit: 1 })
  const out = []
  for (const l of lists) {
    try {
      const page = await get('/people', { smartListId: l.id, limit: 100 })
      const people = listOf(page, ['people'])
      out.push({
        id: l.id,
        name: l.name,
        total: page?._metadata?.total ?? null,
        sampled: people.length,
        mine_in_sample: people.filter((p) => String(p.assignedUserId) === String(myUserId)).length,
        stages: tally(people.map((p) => p.stage || '(none)')),
        tags: tally(people.flatMap((p) => (Array.isArray(p.tags) ? p.tags : []))),
        definition_keys: Object.keys(l).filter((k) => !['id', 'name'].includes(k)),
        definition: l.filters ?? l.criteria ?? l.query ?? null,
      })
    } catch (e) {
      out.push({ id: l.id, name: l.name, error: String(e?.message || e).slice(0, 200) })
    }
  }
  return { list_response_keys: Object.keys(json || {}), all_people_total: all?._metadata?.total ?? null, lists: out }
}

// db: shares the cached Zoho access token (oauth_tokens) with the syncs.
export function zohoAdapter(env, { db = null } = {}) {
  let session = null
  const auth = async () => (session ??= await getAccessToken({ db }))
  // Set ZOHO_CALL_RESULT=true once the live check confirms the org has the
  // stock Call_Result picklist.
  const callResult = env('ZOHO_CALL_RESULT') === 'true'
  const send = async (method, path, body) => {
    const { apiHost, accessToken } = await auth()
    return zohoSend(apiHost, accessToken, method, path, body)
  }
  const readOne = async (path) => {
    const { apiHost, accessToken } = await auth()
    const rec = (await zohoGet(apiHost, accessToken, path)).data?.[0]
    if (!rec) throw new Error(`Zoho GET ${path} returned no record`)
    return rec
  }

  return {
    send: {
      logCall: async ({ externalId, outcome, note, durationMin }) => ({
        id: zohoCreatedId(await send('POST', 'Calls', buildZohoCall({ leadId: externalId, outcome, note, durationMin, callResult }))),
      }),
      addNote: async ({ externalId, subject, body }) => ({
        id: zohoCreatedId(await send('POST', `Leads/${externalId}/Notes`, buildZohoNote({ title: subject, body }))),
      }),
      createTask: async ({ externalId, title, dueDate }) => ({
        id: zohoCreatedId(await send('POST', 'Tasks', buildZohoTask({ leadId: externalId, title, dueDate }))),
      }),
      completeTask: async ({ externalId }) => {
        await send('PUT', 'Tasks', buildZohoTaskUpdate({ id: externalId, complete: true }))
        return { id: externalId }
      },
      pushTask: async ({ externalId, dueDate }) => {
        await send('PUT', 'Tasks', buildZohoTaskUpdate({ id: externalId, dueDate }))
        return { id: externalId }
      },
      // New MPG lead (Zoho assigns the token's user: Chandler).
      createContact: async ({ firstName, lastName, company, phone, email }) => ({
        id: zohoCreatedId(await send('POST', 'Leads', buildZohoLead({ firstName, lastName, company, phone, email }))),
      }),
    },
    read: {
      lead: (id) => readOne(`Leads/${id}`),
      call: (id) => readOne(`Calls/${id}`),
      task: (id) => readOne(`Tasks/${id}`),
      // Every note on one lead (contact card). Profiles without Notes access
      // get NOT_SUPPORTED; the card then shows what the mirror has.
      notesFor: async (leadId) => {
        const { apiHost, accessToken } = await auth()
        return (await zohoGet(apiHost, accessToken, `Leads/${leadId}/Notes`, { per_page: 100 })).data || []
      },
      // Some profiles can't read Notes (NOT_SUPPORTED). zoho-activity-sync never
      // pulls notes, so a mirror built from what we just sent can't collide.
      note: async (id, ctx) => {
        try {
          return await readOne(`Notes/${id}`)
        } catch {
          return {
            id,
            Note_Title: ctx.subject || 'Note from Sales OS',
            Note_Content: ctx.body,
            Parent_Id: { id: ctx.externalId },
            $se_module: 'Leads',
            Created_Time: new Date().toISOString(),
          }
        }
      },
    },
    map: { activity: zohoMapActivity, task: zohoMapTask, contact: (rec) => zohoMapContact(rec, 'Leads') },
  }
}
