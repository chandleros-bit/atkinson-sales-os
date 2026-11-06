// crm-action core: auth result -> resolve -> claim -> flag -> steps -> mirror ->
// record. Everything outside is injected so this runs under vitest with fakes:
//
//   db:            a supabase-js client (service role in production)
//   adapters:      { bay, mpg }, each { send, read, map } (see crm.ts)
//   allowedUserId: the ALLOWED_USER_ID secret
//   userId:        the caller's auth user id (from the verified JWT)
//   role:          the caller's user_roles.role ('owner' | 'assistant' | null)
//
// THE RULE that matters most: mirror rows come from the same mappers the
// scheduled syncs use (adapter.map.* is fub-activity / fub-tasks /
// zoho-activity / zoho-tasks), fed a read-back of the CRM record. The syncs
// store activities as `${type}-${id}`; writing anything else here would make
// the next sync insert a second copy and double the call counts.

import { planSteps, shouldStop, overallStatus, fubPersonGone, PERSON_GONE, ACTIONS, CONTACT_ACTIONS, TASK_ACTIONS, ASSISTANT_ACTIONS, ASSISTANT_REFUSED, ASSISTANT_BAYWAY_ONLY } from './plan.ts'
import { isStageTarget } from '../_shared/bay-stages.ts'
import { mapRelationship } from '../_shared/fub-relationships.ts'
import { isExcludedLead } from '../_shared/zoho.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCE_FOR = { bay: 'fub', mpg: 'zoho' }
const BOOK_LABEL = { bay: 'Bayway', mpg: 'MPG' }
const CRM_LABEL = { bay: 'FUB', mpg: 'Zoho' }
const ON_CONFLICT = { onConflict: 'source_crm,external_id' }

// Actions that make a lead, so they also need create_lead_enabled.
const CREATES_LEAD = new Set(['create_contact', 'promote_prospect'])
// A Zoho record id as the Leads API takes it in a path.
const ZOHO_ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const PROSPECT_COLS = 'id, user_id, business_name, contact_name, contact_role, phone, phone_key, email, address, temperature, status, zoho_lead_id'
// mpg_prospects.promoting_at (0061): one promotion of a prospect at a time.
const LEASE_MS = 2 * 60_000
const PROMOTION_BUSY = 'Already adding this business to Zoho'
const BAD_LEAD_ID = 'Unknown Zoho lead id'

const RELATIONSHIP_TTL_MS = 60 * 60_000
const RELATIONSHIP_MAX = 25

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

// An MPG walk-in and the visit that asked for it to go to Zoho. The function
// runs with the service role, so RLS does not apply: these ownership checks
// are the boundary. Anything not the caller's reads as not found.
async function resolvePromotion(db, req, userId) {
  if (!req.prospect_id || !req.touch_id) return { refuse: 'prospect_id and touch_id are required' }
  const p = await db.from('mpg_prospects').select(PROSPECT_COLS).eq('id', req.prospect_id).maybeSingle()
  if (p.error) throw new Error(`prospect lookup: ${p.error.message}`)
  const t = await db.from('mpg_touches').select('id, user_id, prospect_id, temperature').eq('id', req.touch_id).maybeSingle()
  if (t.error) throw new Error(`touch lookup: ${t.error.message}`)
  const prospect = p.data
  const touch = t.data
  if (!userId || !prospect || !touch || prospect.user_id !== userId || touch.user_id !== userId || touch.prospect_id !== prospect.id) {
    return { refuse: 'Prospect not found' }
  }
  if (prospect.status === 'promoted') return { refuse: 'Already in Zoho' }
  return { target: { businessId: 'mpg', contact: null, task: null, prospect, touch } }
}

// Resolve the request onto our rows. Returns { target } or { refuse }.
async function resolve(db, req, userId) {
  if (req.action === 'promote_prospect') return resolvePromotion(db, req, userId)
  // A new lead: no contact yet; the book comes with the request.
  if (req.action === 'create_contact') {
    if (!SOURCE_FOR[req.business_id]) return { refuse: `Unknown book: ${req.business_id}` }
    return { target: { businessId: req.business_id, contact: null, task: null } }
  }
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

// settings[key] = { bay: bool, mpg: bool }; anything but true is off.
async function settingOn(db, key, businessId) {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle()
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
  if (!isStageTarget(key)) return `Unknown stage: ${key}`
  const ps = String(contact?.person_stage || '').trim().toLowerCase()
  // Pre-Qualified always reads as Application Received unless parked (Nurture / Credit Repair).
  if (ps === 'pre-qualified' && !['application_received', 'nurture', 'credit_repair', 'lost', 'pre_approved', 'disclosed'].includes(key)) {
    return 'This lead is Pre-Qualified in FUB, which always shows as Application Received. Change the FUB stage first.'
  }
  if (ps !== 'lead' && ps !== 'pre-qualified') {
    return `This lead's FUB stage is ${contact?.person_stage || 'empty'}, so it isn't on the board. Set it to Lead in FUB first.`
  }
  return null
}

// Every refusal that is recorded on the crm_actions row, in order. null = go.
async function refusalFor(db, req, target, isAssistant, adapters) {
  const { businessId } = target
  if (isAssistant && !ASSISTANT_ACTIONS.has(req.action)) return ASSISTANT_REFUSED
  if (isAssistant && businessId !== 'bay') return ASSISTANT_BAYWAY_ONLY
  if (!(await settingOn(db, 'writeback_enabled', businessId))) return `Write-back is off for ${BOOK_LABEL[businessId]}`
  if (CREATES_LEAD.has(req.action) && !(await settingOn(db, 'create_lead_enabled', businessId))) {
    return `New lead is off for ${BOOK_LABEL[businessId]}`
  }
  const pre = preflight(req, target)
  if (pre) return pre
  if (!adapters[businessId]) return `No ${CRM_LABEL[businessId] || businessId} adapter`
  return null
}

// Read-only Zoho duplicate check for promote_prospect, before anything is
// claimed. Returns a reply to send now, or null to go on (with
// target.linkLeadId set when exactly one lead matched).
async function searchBeforePromote(adapter, req, target) {
  const p = req.payload || {}
  if (p.link_lead_id || p.create_new || target.prospect.zoho_lead_id) return null
  let candidates
  try {
    candidates = await adapter.send.findLeads({ phoneKey: target.prospect.phone_key, company: target.prospect.business_name })
  } catch (e) {
    return reply(200, { status: 'error', error: msg(e) })
  }
  candidates = Array.isArray(candidates) ? candidates : []
  if (candidates.length > 1) return reply(200, { status: 'choose', candidates })
  if (candidates.length === 1) target.linkLeadId = String(candidates[0].id)
  return null
}

function preflight(req, target) {
  const { businessId, contact, task } = target
  if (contact && contact.source_crm !== SOURCE_FOR[businessId]) return 'Contact is not from this book\'s CRM'
  if (task && task.source_crm !== SOURCE_FOR[businessId]) return 'Task is not from this book\'s CRM'
  if (req.action === 'log_call' && businessId === 'bay' && !contact?.phone) return 'No phone on file in FUB'
  if (req.action === 'create_contact') {
    const p = req.payload || {}
    const has = (k) => typeof p[k] === 'string' && p[k].trim() !== ''
    if (businessId === 'bay') {
      if (!has('first_name') && !has('last_name')) return 'A new lead needs a name'
      if (!has('phone') && !has('email')) return 'A new Bayway lead needs a phone or an email'
    } else {
      if (!has('last_name')) return 'Zoho needs a last name for a new lead'
      if (!has('company')) return 'Zoho needs a company for a new lead'
    }
  }
  if (req.action === 'promote_prospect') {
    // The lead the run would link, where we know it already (a search match
    // is checked in the promote step).
    const p = req.payload || {}
    const link = p.link_lead_id || (p.create_new ? null : target.prospect?.zoho_lead_id)
    if (link && !ZOHO_ID_RE.test(String(link))) return BAD_LEAD_ID
  }
  if (TASK_ACTIONS.has(req.action) && task?.is_completed) return 'Task is already completed'
  if (req.action === 'log_call' && task?.is_completed) return 'That task is already completed'
  if (req.action === 'set_stage') return stageRefusal(businessId, contact, req.payload?.target)
  if (req.action === 'set_temperature') {
    if (businessId !== 'bay') return 'Temperature tags are Bayway only; MPG temperature stays in the dashboard'
    if (!['hot', 'warm', 'cold'].includes(req.payload?.temperature)) return `Unknown temperature: ${req.payload?.temperature}`
  }
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
      // After a create, the lead must be mirrored before a note can attach.
      if (!contact) throw new Error("The new lead isn't in the dashboard yet; add the note after the next sync")
      return adapter.send.addNote({ externalId: contact.external_id, subject: step.subject, body: step.body })
    case 'create_contact':
      return adapter.send.createContact(step.person)
    case 'promote': {
      // Link an existing lead (an "Initial lead" is opened), or create one.
      if (target.linkLeadId) {
        const id = String(target.linkLeadId)
        // Whatever the id came from (request, prospect, search), it goes in a
        // Zoho URL path.
        if (!ZOHO_ID_RE.test(id)) throw new Error(BAD_LEAD_ID)
        const rec = await adapter.read.lead(id)
        if (isExcludedLead(rec)) await adapter.send.setLeadOpen({ externalId: id })
        return { id, linked: true }
      }
      const { prospect } = target
      return adapter.send.createLead({
        business: prospect.business_name, contactName: prospect.contact_name, role: prospect.contact_role,
        phone: prospect.phone, email: prospect.email, address: prospect.address,
      })
    }
    case 'create_task':
      return adapter.send.createTask({
        externalId: contact.external_id, title: step.title, type: step.type, dueDate: step.dueDate,
      })
    case 'complete_task':
      return adapter.send.completeTask({ externalId: task.external_id })
    case 'set_stage':
      return adapter.send.setStage({ externalId: contact.external_id, target: step.target })
    case 'set_temperature':
      return adapter.send.setTemperature({ externalId: contact.external_id, temperature: step.temperature })
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
  if (step.step === 'create_contact' || step.step === 'promote') {
    // Read the new (or linked) lead back and upsert it through the sync's own mapper, then
    // make it the run's contact so the note step attaches to it.
    const rec = target.businessId === 'bay' ? await adapter.read.person(out.id) : await adapter.read.lead(out.id)
    const row = adapter.map.contact(rec)
    const { error } = await db.from('contacts').upsert(row, ON_CONFLICT)
    if (error) throw new Error(`contacts upsert: ${error.message}`)
    const { data } = await db
      .from('contacts')
      .select('id, business_id, source_crm, external_id, name, phone, person_stage')
      .eq('source_crm', row.source_crm)
      .eq('external_id', row.external_id)
      .maybeSingle()
    target.contact = data || null
    return
  }
  if (step.step === 'set_stage' || step.step === 'set_temperature') {
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

// Promotion bookkeeping. Zoho has the lead either way, so a failed write goes
// on the promote result as mirror_error and leaves the run's status alone.
function attemptInto(result) {
  const note = (e) => { result.mirror_error = result.mirror_error ? `${result.mirror_error}; ${e}` : e }
  return async (label, fn) => {
    try {
      const r = await fn()
      if (r?.error) note(`${label}: ${r.error.message}`)
      return r
    } catch (e) {
      note(`${label}: ${msg(e)}`)
      return null
    }
  }
}

// Right after the promote step: the prospect is in Zoho now, whatever the
// note and follow-up steps do.
async function markPromoted(db, target, result, userId, now) {
  await attemptInto(result)('mpg_prospects update', () => db.from('mpg_prospects')
    .update({ zoho_lead_id: String(result.lead_id), status: 'promoted', promoted_at: now.toISOString(), zoho_wanted: false })
    .eq('id', target.prospect.id).eq('user_id', userId))
}

// At the end of a run whose promote worked: point the touch at the contact
// and this crm_actions row, and record the visit's temperature.
async function bookkeepPromotion(db, req, target, result, userId, now) {
  if (result?.step !== 'promote' || !result.ok) return
  const at = now.toISOString()
  const attempt = attemptInto(result)
  const action = await attempt('crm_actions lookup', () => db.from('crm_actions').select('id').eq('client_action_id', req.client_action_id).maybeSingle())
  await attempt('mpg_touches update', () => db.from('mpg_touches')
    .update({ contact_id: target.contact?.id ?? null, crm_action_id: action?.data?.id ?? null })
    .eq('id', target.touch.id).eq('user_id', userId))
  const temperature = target.touch.temperature || target.prospect.temperature
  if (temperature && target.contact) {
    await attempt('lead_ratings upsert', () => db.from('lead_ratings').upsert(
      { contact_id: target.contact.id, business_id: 'mpg', temperature, rated_at: at, rated_by: userId },
      { onConflict: 'contact_id' },
    ))
  }
}

// Take the prospect's promotion lease: one atomic update that only matches
// when no other promotion holds it (null, or older than LEASE_MS). Returns
// { stamp } (null when someone else holds it) or { error }.
async function takeLease(db, prospect, userId, now) {
  const stamp = now.toISOString()
  const stale = new Date(now.getTime() - LEASE_MS).toISOString()
  const { data, error } = await db.from('mpg_prospects')
    .update({ promoting_at: stamp })
    .eq('id', prospect.id)
    .eq('user_id', userId)
    .neq('status', 'promoted')
    .or(`promoting_at.is.null,promoting_at.lt.${stale}`)
    .select('id')
  if (error) return { error: `promotion lease: ${error.message}` }
  return { stamp: Array.isArray(data) && data.length ? stamp : null }
}

// Give it back, only if it is still ours.
async function releaseLease(db, prospect, userId, stamp) {
  try {
    const { error } = await db.from('mpg_prospects')
      .update({ promoting_at: null })
      .eq('id', prospect.id)
      .eq('user_id', userId)
      .eq('promoting_at', stamp)
    if (error) console.error(`promotion lease release failed for ${prospect.id}: ${error.message}`)
  } catch (e) {
    console.error(`promotion lease release failed for ${prospect.id}: ${msg(e)}`)
  }
}

const replayOf = (r) => reply(200, { status: r?.status || 'pending', results: r?.results || [], replay: true })

export async function run(req, { db, adapters, allowedUserId, userId, role = null, now = new Date() }) {
  // Chandler is ALLOWED_USER_ID; the assistant login is a user_roles 'assistant'.
  const isOwner = !!allowedUserId && !!userId && userId === allowedUserId
  const isAssistant = !isOwner && !!userId && role === 'assistant'
  if (!isOwner && !isAssistant) return reply(403, { error: 'Forbidden' })
  // Setup and Smart List reads are Chandler's alone.
  if (isAssistant && (req?.action === 'whoami' || req?.action === 'smart_lists')) return reply(403, { error: 'Forbidden' })
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

  // Read-only: one lead's notes from its CRM into the activities mirror, for
  // the contact card (the activity syncs only pull notes for recent leads).
  // Writes nothing to the CRM and leaves no crm_actions row.
  if (req.action === 'contact_notes') {
    if (!req.contact_id) return reply(200, { status: 'refused', error: 'contact_id is required' })
    const contact = await loadContact(db, req.contact_id)
    if (!contact) return reply(200, { status: 'refused', error: 'Contact not found' })
    if (isAssistant && contact.business_id !== 'bay') return reply(200, { status: 'refused', error: ASSISTANT_BAYWAY_ONLY })
    const adapter = adapters[contact.business_id]
    try {
      const recs = await adapter.read.notesFor(String(contact.external_id))
      const ids = new Map([[String(contact.external_id), contact.id]])
      const seen = new Set()
      const rows = (recs || [])
        .map((r) => adapter.map.activity(r, 'note', ids))
        .filter((r) => r.contact_id === contact.id && !seen.has(r.external_id) && seen.add(r.external_id))
      if (rows.length) {
        const { error } = await db.from('activities').upsert(rows, ON_CONFLICT)
        if (error) throw new Error(`activities upsert: ${error.message}`)
      }
      return reply(200, { status: 'ok', notes: rows.length })
    } catch (e) {
      return reply(200, { status: 'error', error: msg(e) })
    }
  }

  // Read-only: the buyer's / seller's agents on Bayway borrowers (Tuesday
  // loan status), from FUB Relationships into contact_relationships. Each
  // borrower is pulled at most once an hour; a pull replaces their agents.
  // Writes nothing to the CRM and leaves no crm_actions row.
  if (req.action === 'contact_relationships') {
    const ids = Array.isArray(req.payload?.contact_ids) ? [...new Set(req.payload.contact_ids.map(String))] : []
    if (!ids.length) return reply(200, { status: 'refused', error: 'contact_ids is required' })
    if (ids.length > RELATIONSHIP_MAX) return reply(200, { status: 'refused', error: `At most ${RELATIONSHIP_MAX} contacts at a time` })
    let synced = 0
    let skipped = 0
    const errors = []
    for (const id of ids) {
      const contact = await loadContact(db, id)
      if (!contact || contact.business_id !== 'bay') { skipped++; continue }
      const { data: last } = await db.from('contact_relationship_syncs').select('synced_at').eq('contact_id', id).maybeSingle()
      if (last?.synced_at && now.getTime() - new Date(last.synced_at).getTime() < RELATIONSHIP_TTL_MS) { skipped++; continue }
      try {
        const recs = await adapters.bay.read.relationshipsFor(String(contact.external_id))
        const rows = (recs || []).map((r) => mapRelationship(r, id)).filter(Boolean)
        const del = await db.from('contact_relationships').delete().eq('contact_id', id)
        if (del.error) throw new Error(`contact_relationships delete: ${del.error.message}`)
        if (rows.length) {
          const ins = await db.from('contact_relationships').insert(rows.map((r) => ({ ...r, synced_at: now.toISOString() })))
          if (ins.error) throw new Error(`contact_relationships insert: ${ins.error.message}`)
        }
        const stamp = await db.from('contact_relationship_syncs').upsert({ contact_id: id, synced_at: now.toISOString() }, { onConflict: 'contact_id' })
        if (stamp.error) throw new Error(`contact_relationship_syncs: ${stamp.error.message}`)
        synced++
      } catch (e) {
        errors.push({ contact_id: id, error: msg(e) })
      }
    }
    if (errors.length && !synced) return reply(200, { status: 'error', error: errors[0].error, errors })
    return reply(200, { status: 'ok', synced, skipped, errors })
  }

  // The same promotion submitted again replays what it did, before the
  // prospect's own state ("Already in Zoho") would refuse it.
  if (req.action === 'promote_prospect') {
    const { data: prior } = await db
      .from('crm_actions')
      .select('status, results, request, user_id')
      .eq('client_action_id', req.client_action_id)
      .maybeSingle()
    if (prior && prior.user_id === userId) return replayOf(prior)
  }

  const resolved = await resolve(db, req, userId)
  if (resolved.refuse) return reply(200, { status: 'refused', error: resolved.refuse })
  const target = resolved.target

  // promote_prospect: once the checks the claim path runs have passed (a
  // refused request is claimed and refused below instead, and never reaches
  // Zoho), take the prospect's lease so a second promotion can't make a
  // second lead, then search Zoho before the claim. The lease is given back
  // however the run ends.
  let lease = null
  if (req.action === 'promote_prospect' && !(await refusalFor(db, req, target, isAssistant, adapters))) {
    lease = await takeLease(db, target.prospect, userId, now)
    if (lease.error) return reply(200, { status: 'error', error: lease.error })
    if (!lease.stamp) return reply(200, { status: 'busy', error: PROMOTION_BUSY })
  }
  try {
    return await perform({ db, adapters, req, target, userId, isAssistant, now, leased: !!lease })
  } finally {
    if (lease?.stamp) await releaseLease(db, target.prospect, userId, lease.stamp)
  }
}

// Claim -> refusals -> steps -> mirror -> record, for a resolved request.
async function perform({ db, adapters, req, target, userId, isAssistant, now, leased }) {
  const { businessId } = target

  // "Pick one" and a failed search leave no crm_actions row.
  if (leased) {
    const early = await searchBeforePromote(adapters[businessId], req, target)
    if (early) return early
  }

  const claimed = await claim(db, {
    client_action_id: req.client_action_id,
    user_id: userId,
    action: req.action,
    business_id: businessId,
    contact_id: target.contact?.id || null,
    task_id: target.task?.id || null,
    request: req,
  })
  if (claimed.replay) return replayOf(claimed.replay)

  const refuse = async (error) => {
    await finish(db, req.client_action_id, { status: 'refused', results: [{ step: req.action, ok: false, error }] })
    return reply(200, { status: 'refused', error })
  }
  const refusal = await refusalFor(db, req, target, isAssistant, adapters)
  if (refusal) return refuse(refusal)

  const adapter = adapters[businessId]
  if (req.action === 'promote_prospect') {
    // A chosen lead wins; create_new skips the stored lead and the search.
    const p = req.payload || {}
    target.linkLeadId = p.link_lead_id || (p.create_new ? null : target.prospect.zoho_lead_id || target.linkLeadId) || null
  }

  const results = []
  for (const step of planSteps(req)) {
    const result = { step: step.step }
    try {
      const out = await send(adapter, step, target)
      result.ok = true
      result.crm_id = out.id
      if (out.rescheduled) result.rescheduled = true
      // Where a stage move came from, so the UI can undo it.
      if (out.previous) result.previous_target = out.previous
      if (out.existing) result.existing = true
      try {
        await mirror(db, adapter, step, out, target, now)
      } catch (e) {
        // The CRM has it; the next sync heals the mirror. Report success.
        result.mirror_error = msg(e)
      }
      if (step.step === 'create_contact' && target.contact) result.contact_id = target.contact.id
      if (step.step === 'promote') {
        if (target.contact) result.contact_id = target.contact.id
        result.lead_id = out.id
        result.linked = !!out.linked
        await markPromoted(db, target, result, userId, now)
      }
    } catch (e) {
      result.ok = false
      result.error = msg(e)
      // Deleted in FUB: drop our copy (and what hangs off it) and stop.
      if (businessId === 'bay' && target.contact && fubPersonGone(result.error, target.contact.external_id)) {
        const { error } = await db.rpc('remove_fub_contacts', { ext_ids: [String(target.contact.external_id)] })
        if (!error) {
          result.contact_removed = true
          result.error = PERSON_GONE
          results.push(result)
          break
        }
        console.error(`remove_fub_contacts failed for ${target.contact.external_id}: ${error.message}`)
      }
    }
    results.push(result)
    if (shouldStop(step.step, result.ok)) break
  }

  if (req.action === 'promote_prospect') await bookkeepPromotion(db, req, target, results[0], userId, now)

  const status = overallStatus(results)
  const patch = { status, results }
  // A new (or promoted) lead: point the audit row at the contact.
  if (CREATES_LEAD.has(req.action) && target.contact) patch.contact_id = target.contact.id
  await finish(db, req.client_action_id, patch)
  return reply(200, { status, results })
}
