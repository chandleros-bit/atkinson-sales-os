// crm-action core: auth result -> resolve -> claim -> flag -> steps -> mirror ->
// record. Everything outside is injected so this runs under vitest with fakes:
//
//   db:            a supabase-js client (service role in production)
//   adapters:      { bay, mpg }, each { send, read, map } (see crm.ts)
//   allowedUserId: the ALLOWED_USER_ID secret
//   userId:        the caller's auth user id (from the verified JWT)
//
// THE RULE that matters most: mirror rows come from the same mappers the
// scheduled syncs use (adapter.map.* is fub-activity / fub-tasks /
// zoho-activity / zoho-tasks), fed a read-back of the CRM record. The syncs
// store activities as `${type}-${id}`; writing anything else here would make
// the next sync insert a second copy and double the call counts.

import { planSteps, shouldStop, overallStatus, ACTIONS, CONTACT_ACTIONS, TASK_ACTIONS } from './plan.ts'
import { STAGE_TARGETS } from '../_shared/bay-stages.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCE_FOR = { bay: 'fub', mpg: 'zoho' }
const BOOK_LABEL = { bay: 'Bayway', mpg: 'MPG' }
const CRM_LABEL = { bay: 'FUB', mpg: 'Zoho' }
const ON_CONFLICT = { onConflict: 'source_crm,external_id' }

const reply = (http, body) => ({ http, body })
const msg = (e) => String(e?.message || e).slice(0, 500)

async function loadContact(db, id) {
  const { data, error } = await db
    .from('contacts')
    .select('id, business_id, source_crm, external_id, name, phone, person_stage')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`contact lookup: ${error.message}`)
  return data
}

async function loadTask(db, id) {
  const { data, error } = await db
    .from('tasks')
    .select('id, business_id, source_crm, external_id, contact_id, deal_id, title, task_type, is_completed')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`task lookup: ${error.message}`)
  return data
}

async function dealMapFor(db, task) {
  if (!task?.deal_id) return new Map()
  const { data } = await db.from('deals').select('id, external_id').eq('id', task.deal_id).maybeSingle()
  return data ? new Map([[String(data.external_id), data.id]]) : new Map()
}

// Resolve the request onto our rows. Returns { target } or { refuse }.
async function resolve(db, req) {
  if (CONTACT_ACTIONS.has(req.action)) {
    if (!req.contact_id) return { refuse: 'contact_id is required' }
    const contact = await loadContact(db, req.contact_id)
    if (!contact) return { refuse: 'Contact not found' }
    let openTask = null
    if (req.payload?.complete_task_id) {
      openTask = await loadTask(db, req.payload.complete_task_id)
      if (!openTask || openTask.contact_id !== contact.id) return { refuse: 'That task does not belong to this contact' }
    }
    return { target: { businessId: contact.business_id, contact, task: openTask } }
  }
  if (TASK_ACTIONS.has(req.action)) {
    if (!req.task_id) return { refuse: 'task_id is required' }
    const task = await loadTask(db, req.task_id)
    if (!task) return { refuse: 'Task not found' }
    const contact = task.contact_id ? await loadContact(db, task.contact_id) : null
    return { target: { businessId: task.business_id, contact, task } }
  }
  return { refuse: `Unknown action: ${req.action}` }
}

async function writebackEnabled(db, businessId) {
  const { data } = await db.from('settings').select('value').eq('key', 'writeback_enabled').maybeSingle()
  return data?.value?.[businessId] === true
}

// Insert the crm_actions row first: the unique client_action_id picks one
// winner when the same submit arrives twice. Returns { claimed } or { replay }.
async function claim(db, row) {
  const { error } = await db.from('crm_actions').insert({ ...row, status: 'pending' })
  if (!error) return { claimed: true }
  if (error.code !== '23505') throw new Error(`crm_actions insert: ${error.message}`)
  const { data } = await db
    .from('crm_actions')
    .select('status, results, request')
    .eq('client_action_id', row.client_action_id)
    .maybeSingle()
  return { replay: data }
}

async function finish(db, clientActionId, patch) {
  const { error } = await db.from('crm_actions').update(patch).eq('client_action_id', clientActionId)
  if (error) console.error(`crm_actions update failed for ${clientActionId}: ${error.message}`)
}

// Bayway stages are FUB tags (bay-stages.ts); MPG's come from Zoho.
function stageRefusal(businessId, contact, key) {
  if (businessId !== 'bay') return 'Move stage is Bayway only; MPG stages come from Zoho'
  if (!STAGE_TARGETS.some((t) => t.key === key)) return `Unknown stage: ${key}`
  const ps = String(contact?.person_stage || '').trim().toLowerCase()
  // Pre-Qualified always reads as Application Received unless parked (Credit Repair).
  if (ps === 'pre-qualified' && !['application_received', 'credit_repair'].includes(key)) {
    return 'This lead is Pre-Qualified in FUB, which always shows as Application Received. Change the FUB stage first.'
  }
  if (ps !== 'lead' && ps !== 'pre-qualified') {
    return `This lead's FUB stage is ${contact?.person_stage || 'empty'}, so it isn't on the board. Set it to Lead in FUB first.`
  }
  return null
}

function preflight(req, target) {
  const { businessId, contact, task } = target
  if (contact && contact.source_crm !== SOURCE_FOR[businessId]) return 'Contact is not from this book\'s CRM'
  if (task && task.source_crm !== SOURCE_FOR[businessId]) return 'Task is not from this book\'s CRM'
  if (req.action === 'log_call' && businessId === 'bay' && !contact?.phone) return 'No phone on file in FUB'
  if (TASK_ACTIONS.has(req.action) && task?.is_completed) return 'Task is already completed'
  if (req.action === 'log_call' && task?.is_completed) return 'That task is already completed'
  if (req.action === 'set_stage') return stageRefusal(businessId, contact, req.payload?.target)
  // "No next step: Moving to Nurture" parks the lead after the call.
  if (req.action === 'log_call' && req.payload?.set_stage) return stageRefusal(businessId, contact, req.payload.set_stage)
  return null
}

// Run one step against the CRM. Returns what the mirror needs.
async function send(adapter, step, target) {
  const { contact, task } = target
  switch (step.step) {
    case 'log_call':
      return adapter.send.logCall({
        externalId: contact.external_id, phone: contact.phone,
        outcome: step.outcome, note: step.note, durationMin: step.durationMin,
      })
    case 'add_note':
      return adapter.send.addNote({ externalId: contact.external_id, subject: step.subject, body: step.body })
    case 'create_task':
      return adapter.send.createTask({
        externalId: contact.external_id, title: step.title, type: step.type, dueDate: step.dueDate,
      })
    case 'complete_task':
      return adapter.send.completeTask({ externalId: task.external_id })
    case 'set_stage':
      return adapter.send.setStage({ externalId: contact.external_id, target: step.target })
    case 'push_task':
      return adapter.send.pushTask({
        externalId: task.external_id, dueDate: step.dueDate,
        contactExternalId: contact?.external_id, title: task.title, type: task.task_type,
      })
    default:
      throw new Error(`No sender for ${step.step}`)
  }
}

// Read the record back and upsert it through the sync's own mapper.
async function mirror(db, adapter, step, out, target, now) {
  const { contact, task } = target
  const contactMap = contact ? new Map([[String(contact.external_id), contact.id]]) : new Map()
  if (step.step === 'set_stage') {
    // Re-read the person and upsert it through the people sync's own mapper;
    // the stage trigger then records the move (stage_key / stage_since).
    const rec = await adapter.read.person(out.id)
    const { error } = await db.from('contacts').upsert(adapter.map.contact(rec), ON_CONFLICT)
    if (error) throw new Error(`contacts upsert: ${error.message}`)
    return
  }
  if (step.step === 'log_call' || step.step === 'add_note') {
    const type = step.step === 'log_call' ? 'call' : 'note'
    const rec = type === 'call'
      ? await adapter.read.call(out.id)
      : await adapter.read.note(out.id, { externalId: contact.external_id, subject: step.subject, body: step.body })
    const row = adapter.map.activity(rec, type, contactMap)
    const { error } = await db.from('activities').upsert(row, ON_CONFLICT)
    if (error) throw new Error(`activities upsert: ${error.message}`)
    const touch = await db.from('contacts').update({ last_touch_at: now.toISOString() }).eq('id', contact.id)
    if (touch.error) throw new Error(`last_touch_at: ${touch.error.message}`)
    return
  }
  const dealMap = await dealMapFor(db, step.step === 'create_task' ? null : task)
  for (const id of [out.id, ...(out.also || [])]) {
    const rec = await adapter.read.task(id)
    const row = adapter.map.task(rec, contactMap, dealMap)
    const { error } = await db.from('tasks').upsert(row, ON_CONFLICT)
    if (error) throw new Error(`tasks upsert: ${error.message}`)
  }
}

export async function run(req, { db, adapters, allowedUserId, userId, now = new Date() }) {
  if (!allowedUserId || !userId || userId !== allowedUserId) return reply(403, { error: 'Forbidden' })
  if (!req || !UUID_RE.test(String(req.client_action_id || ''))) {
    return reply(400, { error: 'client_action_id (uuid) is required' })
  }
  if (!ACTIONS.includes(req.action)) return reply(400, { error: `Unknown action: ${req.action}` })

  // Setup check only: who owns FUB_API_KEY. Writes nothing.
  if (req.action === 'whoami') {
    try {
      return reply(200, { status: 'ok', whoami: await adapters.bay.whoami() })
    } catch (e) {
      return reply(200, { status: 'error', error: msg(e) })
    }
  }

  // Read-only: FUB Smart Lists with a summary of who is in each (counts,
  // person stages, top tags), to see what each list is built on. No names.
  if (req.action === 'smart_lists') {
    try {
      return reply(200, { status: 'ok', smart_lists: await adapters.bay.smartLists() })
    } catch (e) {
      return reply(200, { status: 'error', error: msg(e) })
    }
  }

  const resolved = await resolve(db, req)
  if (resolved.refuse) return reply(200, { status: 'refused', error: resolved.refuse })
  const target = resolved.target
  const { businessId } = target

  const claimed = await claim(db, {
    client_action_id: req.client_action_id,
    user_id: userId,
    action: req.action,
    business_id: businessId,
    contact_id: target.contact?.id || null,
    task_id: target.task?.id || null,
    request: req,
  })
  if (claimed.replay) {
    const r = claimed.replay || {}
    return reply(200, { status: r.status || 'pending', results: r.results || [], replay: true })
  }

  const refuse = async (error) => {
    await finish(db, req.client_action_id, { status: 'refused', results: [{ step: req.action, ok: false, error }] })
    return reply(200, { status: 'refused', error })
  }
  if (!(await writebackEnabled(db, businessId))) return refuse(`Write-back is off for ${BOOK_LABEL[businessId]}`)
  const pre = preflight(req, target)
  if (pre) return refuse(pre)

  const adapter = adapters[businessId]
  if (!adapter) return refuse(`No ${CRM_LABEL[businessId] || businessId} adapter`)

  const results = []
  for (const step of planSteps(req)) {
    const result = { step: step.step }
    try {
      const out = await send(adapter, step, target)
      result.ok = true
      result.crm_id = out.id
      if (out.rescheduled) result.rescheduled = true
      try {
        await mirror(db, adapter, step, out, target, now)
      } catch (e) {
        // The CRM has it; the next sync heals the mirror. Report success.
        result.mirror_error = msg(e)
      }
    } catch (e) {
      result.ok = false
      result.error = msg(e)
    }
    results.push(result)
    if (shouldStop(step.step, result.ok)) break
  }

  const status = overallStatus(results)
  await finish(db, req.client_action_id, { status, results })
  return reply(200, { status, results })
}
