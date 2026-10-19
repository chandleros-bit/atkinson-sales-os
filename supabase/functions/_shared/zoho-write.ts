// Pure Zoho CRM (MPG) request-body builders for crm-action (CRM write-back).
// MPG's book lives on Leads, so related records point at the lead through
// What_Id with $se_module 'Leads' (Who_Id is for Contacts), the same rule
// zoho-activity.ts reads back. Bodies are wrapped as { data: [ {...} ] }.
//
// VERIFY on the first live run against the "ZZ Test Sales OS" lead: the
// Call_Duration format (zohoDuration) and whether this org has a Call_Result
// picklist (buildZohoCall's callResult option). See docs/phase-writeback-setup.md.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n) => String(n).padStart(2, '0')

function dueDateOf(dueDate) {
  if (!DATE_RE.test(String(dueDate || ''))) throw new Error(`Due date must be YYYY-MM-DD, got ${dueDate}`)
  return dueDate
}

// Minutes -> Zoho's Call_Duration. Docs disagree between mm:ss and hh:mm; this
// is mm:ss. Change it here, in one place, if the live check says otherwise.
export function zohoDuration(minutes) {
  const totalSec = Math.max(0, Math.round(Number(minutes || 0) * 60))
  return `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`
}

// ISO 8601 with an explicit offset, which Zoho requires (it rejects a bare Z).
export function zohoDateTime(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

// Zoho's stock Call_Result picklist, mapped from FUB's outcome labels.
const CALL_RESULT = {
  Interested: 'Interested',
  'Not interested': 'Not interested',
  'Left message': 'No response/Busy',
  'No answer': 'No response/Busy',
  Busy: 'No response/Busy',
  'Bad number': 'Invalid number',
}

export function zohoCallResult(outcome) {
  return CALL_RESULT[outcome] || null
}

// POST /crm/v2/Calls. A completed call needs Call_Start_Time and
// Call_Duration, and Zoho rejects one whose start + duration is in the future,
// so it starts duration + 1 minute ago.
export function buildZohoCall({ leadId, outcome, note, durationMin, now = new Date(), callResult = false }) {
  if (!CALL_RESULT[outcome]) throw new Error(`Unknown call outcome: ${outcome}`)
  if (!leadId) throw new Error('Missing Zoho lead id')
  const minutes = Number(durationMin) > 0 ? Number(durationMin) : 1
  const start = new Date(new Date(now).getTime() - (minutes + 1) * 60000)
  const rec = {
    Subject: `Call: ${outcome}`,
    Call_Type: 'Outbound',
    Call_Start_Time: zohoDateTime(start),
    Call_Duration: zohoDuration(minutes),
    Description: note ? `${outcome}: ${note}` : outcome,
    What_Id: String(leadId),
    $se_module: 'Leads',
  }
  if (callResult) rec.Call_Result = zohoCallResult(outcome)
  return { data: [rec] }
}

// POST /crm/v2/Leads/{leadId}/Notes.
export function buildZohoNote({ title, body }) {
  if (!body) throw new Error('Note body is empty')
  return { data: [{ Note_Title: title || 'Note from Sales OS', Note_Content: body }] }
}

// POST /crm/v2/Tasks.
export function buildZohoTask({ leadId, title, dueDate }) {
  if (!leadId) throw new Error('Missing Zoho lead id')
  return {
    data: [{
      Subject: title || 'Follow up',
      Due_Date: dueDateOf(dueDate),
      Status: 'Not Started',
      What_Id: String(leadId),
      $se_module: 'Leads',
    }],
  }
}

// PUT /crm/v2/Tasks. 'Completed' is a value zohoTaskIsCompleted treats as done.
export function buildZohoTaskUpdate({ id, complete, dueDate }) {
  if (!id) throw new Error('Missing Zoho task id')
  if (complete) return { data: [{ id: String(id), Status: 'Completed' }] }
  return { data: [{ id: String(id), Due_Date: dueDateOf(dueDate) }] }
}

// The new record's id from a Zoho create response.
export function zohoCreatedId(json) {
  const id = json?.data?.[0]?.details?.id
  if (!id) throw new Error(`Zoho create returned no id: ${JSON.stringify(json).slice(0, 200)}`)
  return String(id)
}
