// FollowUpBoss task fetchers + field mapping for the scheduled task sync.
// Normalizes each FUB task into a `tasks` row (business_id 'bay',
// source_crm 'fub').
//
// VERIFY BEFORE FIRST REAL RUN (same convention as fub.ts / fub-activity.ts):
// the /tasks endpoint's list key, the due-date field name, the completion flag,
// and the presence of personId are written from FollowUpBoss's documented shape
// and should be checked against a live response and adjusted here. The sync
// function records the reason for a failed pass in sync_log.message.
//
// NOTE: some FUB list endpoints refuse to list account-wide (/textMessages and
// /emails 400 without a person filter — see fub-activity.ts). If /tasks turns
// out to be one of them, fall back to a per-contact fetch bounded to
// recently-touched contacts, exactly as the email pass does in
// fub-activity-sync/index.ts. See docs/phase-tasks-setup.md.

import { fubGet } from './fub.ts'

// Paginate the FUB /tasks list endpoint. `listKeys` are candidate top-level
// array keys (FUB casing varies by resource); the first present wins.
// A server that ignores `offset` and keeps returning a full page would spin
// this loop until the Edge Function's wall clock kills it, with nothing in
// sync_log to explain why. Cap the pages instead.
const MAX_PAGES = 100

async function fubListTasks(sinceIso, extraParams = {}) {
  const listKeys = ['tasks']
  const limit = 100
  let offset = 0
  let pages = 0
  const items = []
  const pick = (json) => {
    for (const k of listKeys) {
      if (Array.isArray(json[k])) return json[k]
      if (Array.isArray(json._embedded?.[k])) return json._embedded[k]
    }
    return []
  }
  while (true) {
    const params = { limit, offset, sort: 'updated', ...extraParams }
    if (sinceIso) params.updatedAfter = sinceIso
    const json = await fubGet('/tasks', params)
    const page = pick(json)
    if (page.length === 0) break
    items.push(...page)
    if (page.length < limit) break
    if (++pages >= MAX_PAGES) {
      throw new Error(`FUB /tasks exceeded ${MAX_PAGES} pages — pagination may not be advancing`)
    }
    offset += limit
  }
  return items
}

// First run: open tasks only, so we don't drag in the full completed history.
export const fetchOpenTasks = () => fubListTasks(null, { isCompleted: false })

// Incremental runs: everything changed since the last ok run, ANY status, so a
// task completed in FUB flows through and drops off the board via v_tasks.
export const fetchTasksUpdatedSince = (since) => fubListTasks(since)

// --- Pure mapping helpers (unit-tested) ------------------------------------

export function taskDueAt(rec) {
  return rec.dueDate || rec.due || rec.dueAt || null
}

export function taskTitle(rec) {
  return rec.name || rec.subject || rec.description || 'Task'
}

export function taskIsCompleted(rec) {
  if (typeof rec.isCompleted === 'boolean') return rec.isCompleted
  if (typeof rec.completed === 'boolean') return rec.completed
  return false
}

// contactIdByExternal: Map<fub person id (string), our contacts.id (uuid)>
// dealIdByExternal:    Map<fub deal id (string),   our deals.id (uuid)>
export function mapTask(rec, contactIdByExternal, dealIdByExternal) {
  const personId = rec.personId ?? rec.person?.id ?? null
  const dealId = rec.dealId ?? rec.deal?.id ?? null
  return {
    business_id: 'bay',
    source_crm: 'fub',
    external_id: String(rec.id),
    contact_id: (personId != null && contactIdByExternal.get(String(personId))) || null,
    deal_id: (dealId != null && dealIdByExternal.get(String(dealId))) || null,
    title: taskTitle(rec),
    task_type: rec.type || null,
    due_at: taskDueAt(rec),
    priority: rec.priority || null,
    owner: rec.assignedTo || rec.assignedUserName || null,
    is_completed: taskIsCompleted(rec),
    raw: rec,
    updated_at: new Date().toISOString(),
  }
}

// Open-set reconciliation for completed tasks. An incremental updatedAfter pull
// does not reliably re-fetch a task once it's completed in FUB, so the board
// (v_tasks filters is_completed=false) would never drop it. Given the set of
// external_ids currently OPEN in FUB and our still-open fub rows, return the
// ids of the rows to mark completed: those no longer present in the open set.
//
// openExternalIds: Set<string> of external_ids currently open in FUB.
// ourOpenRows:     [{ id, external_id }] — our fub rows still is_completed=false.
export function reconcileCompleted(openExternalIds, ourOpenRows) {
  return ourOpenRows
    .filter((r) => !openExternalIds.has(String(r.external_id)))
    .map((r) => r.id)
}
