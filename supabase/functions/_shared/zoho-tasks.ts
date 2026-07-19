// Zoho CRM (MPG) Tasks fetcher + field mapping for the scheduled task sync.
// Normalizes each Zoho task into a `tasks` row (business_id 'mpg',
// source_crm 'zoho'). Read-only: only GETs from Zoho.
//
// VERIFY BEFORE FIRST REAL RUN (same convention as zoho.ts): the module API
// name ('Tasks'), the Status value that means done, the Due_Date format, and
// that Who_Id / What_Id carry the ids used for contact / deal resolution.
// See docs/phase-tasks-setup.md.

import { zohoList } from './zoho.ts'

// Incremental via If-Modified-Since; 204/304 are handled inside zohoGet.
export async function fetchTasks(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Tasks', sinceIso)
}

// --- Pure mapping helpers (unit-tested) ------------------------------------

export function zohoTaskIsCompleted(rec) {
  return String(rec.Status || '').toLowerCase() === 'completed'
}

// contactIdByExternal: Map<zoho contact id (string), our contacts.id (uuid)>
// dealIdByExternal:    Map<zoho deal id (string),    our deals.id (uuid)>
export function mapTask(rec, contactIdByExternal, dealIdByExternal) {
  const whoId = rec.Who_Id && rec.Who_Id.id ? String(rec.Who_Id.id) : null
  const whatId = rec.What_Id && rec.What_Id.id ? String(rec.What_Id.id) : null
  // What_Id is polymorphic (Deals | Accounts | …). Trust $se_module when Zoho
  // sends it; otherwise accept the id only if it is a deal we already synced.
  const seModule = rec['$se_module'] || null
  const whatIsDeal = seModule ? seModule === 'Deals' : true
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    external_id: String(rec.id),
    contact_id: (whoId && contactIdByExternal.get(whoId)) || null,
    deal_id: (whatIsDeal && whatId && dealIdByExternal.get(whatId)) || null,
    title: rec.Subject || 'Task',
    task_type: rec.Task_Type || rec.Category || null,
    due_at: rec.Due_Date || null,
    priority: rec.Priority || null,
    owner: (rec.Owner && (rec.Owner.name || rec.Owner.full_name)) || null,
    is_completed: zohoTaskIsCompleted(rec),
    raw: rec,
    updated_at: new Date().toISOString(),
  }
}
