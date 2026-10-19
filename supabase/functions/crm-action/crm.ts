// Real CRM adapters for crm-action: { send, read, map } per book. Thin on
// purpose: request bodies come from the pure builders in _shared/*-write.ts,
// and map.* are the scheduled syncs' own mappers (see run.ts for why).
//
// VERIFY on the first live run (see docs/phase-writeback-setup.md): FUB's
// single-record read paths (/calls/{id}, /notes/{id}, /tasks/{id}, /me) and
// whether PUT /tasks/{id} accepts dueDate (FUB_PUSH_MODE).

import { fubGet, fubSend } from '../_shared/fub.ts'
import { buildFubCall, buildFubNote, buildFubTask, buildFubTaskUpdate, FUB_TASK_TYPES } from '../_shared/fub-write.ts'
import { mapActivity as fubMapActivity } from '../_shared/fub-activity.ts'
import { mapTask as fubMapTask } from '../_shared/fub-tasks.ts'
import { getAccessToken, zohoGet, zohoSend } from '../_shared/zoho.ts'
import {
  buildZohoCall, buildZohoNote, buildZohoTask, buildZohoTaskUpdate, zohoCreatedId,
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
      task: (id) => fubGet(`/tasks/${id}`),
    },
    map: { activity: fubMapActivity, task: fubMapTask },
    whoami: async () => {
      const me = await fubGet('/me')
      return { id: me.id, name: me.name, email: me.email, role: me.role }
    },
  }
}

export function zohoAdapter(env) {
  let session = null
  const auth = async () => (session ??= await getAccessToken())
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
    },
    read: {
      call: (id) => readOne(`Calls/${id}`),
      task: (id) => readOne(`Tasks/${id}`),
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
    map: { activity: zohoMapActivity, task: zohoMapTask },
  }
}
